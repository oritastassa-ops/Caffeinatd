import { SupabaseClient } from "@supabase/supabase-js";
import { AIProvider } from "@/lib/ai/types";
import { MemoryKind } from "@/lib/types";
import { rankMemories, ScorableMemory } from "./ranking";

export interface RecalledMemory {
  id: string;
  kind: string;
  content: string;
}

const CANDIDATE_POOL = 20;
const DUPLICATE_THRESHOLD = 0.9; // near-identical meaning, not just related

/**
 * Retrieval-based recall: semantic when the provider can embed, keyword
 * fallback otherwise. Pulls a wider candidate pool from pgvector, then
 * re-ranks by similarity + importance + recency + usage frequency in JS —
 * never returns the whole store.
 */
export async function recallMemories(
  supabase: SupabaseClient,
  provider: AIProvider,
  userId: string,
  query: string,
  limit = 6,
): Promise<RecalledMemory[]> {
  // Skip the embed call entirely when the user has nothing stored yet —
  // one fewer AI call against the free-tier rate limit, common early on.
  const { count } = await supabase
    .from("memories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (!count) return [];

  let recalled: RecalledMemory[] = [];

  if (provider.embed) {
    try {
      const embedding = await provider.embed(query);
      const { data } = await supabase.rpc("match_memories", {
        p_user_id: userId,
        p_embedding: embedding,
        p_threshold: 0.55,
        p_count: CANDIDATE_POOL,
      });
      const candidates = (data ?? []) as (ScorableMemory & RecalledMemory)[];
      recalled = rankMemories(candidates, limit);
    } catch {
      // fall through to keyword search
    }
  }

  if (recalled.length === 0) {
    const words = query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    if (words.length > 0) {
      const { data } = await supabase
        .from("memories")
        .select("id, kind, content")
        .eq("user_id", userId)
        .or(words.map((w) => `content.ilike.%${w}%`).join(","))
        .limit(limit);
      recalled = (data ?? []) as RecalledMemory[];
    }
  }

  if (recalled.length > 0) {
    // Usage telemetry — one parallel batch instead of N serial round-trips,
    // since this sits on the hot path of every assistant message.
    await Promise.all([
      supabase
        .from("memories")
        .update({ last_used_at: new Date().toISOString() })
        .in("id", recalled.map((m) => m.id)),
      ...recalled.map((m) => supabase.rpc("increment_memory_usage", { p_id: m.id }).select()),
    ]);
  }
  return recalled;
}

export async function saveMemory(
  supabase: SupabaseClient,
  provider: AIProvider,
  userId: string,
  kind: MemoryKind,
  content: string,
  importance = 3,
  confidence = 5,
): Promise<{ id: string; deduped: boolean }> {
  let embedding: number[] | null = null;
  if (provider.embed) {
    try {
      embedding = await provider.embed(content);
    } catch {
      // stored without embedding; keyword fallback still finds it
    }
  }

  // Duplicate check: a near-identical fact already stored gets refreshed
  // (touch last_used_at, bump usage) instead of creating a second row.
  if (embedding) {
    const { data } = await supabase.rpc("match_memories", {
      p_user_id: userId,
      p_embedding: embedding,
      p_threshold: DUPLICATE_THRESHOLD,
      p_count: 1,
    });
    const existing = (data ?? [])[0] as { id: string } | undefined;
    if (existing) {
      await supabase
        .from("memories")
        .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { id: existing.id, deduped: true };
    }
  }

  const { data, error } = await supabase
    .from("memories")
    .insert({ user_id: userId, kind, content, importance, confidence, embedding })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to save memory: ${error.message}`);
  return { id: data.id, deduped: false };
}

export async function updateMemory(
  supabase: SupabaseClient,
  provider: AIProvider,
  id: string,
  content: string,
): Promise<void> {
  let embedding: number[] | null = null;
  if (provider.embed) {
    try {
      embedding = await provider.embed(content);
    } catch {
      // keep the old embedding rather than blocking the edit
    }
  }
  const patch: Record<string, unknown> = { content, updated_at: new Date().toISOString() };
  if (embedding) patch.embedding = embedding;
  const { error } = await supabase.from("memories").update(patch).eq("id", id);
  if (error) throw new Error(`Failed to update memory: ${error.message}`);
}
