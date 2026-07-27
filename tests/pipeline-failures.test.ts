import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProvider } from "@/lib/ai/types";
import type { Profile } from "@/lib/types";

// Memory recall hits the DB/provider; stub it so these tests target the pipeline's
// failure handling, not retrieval. saveMemory is exported too (executor imports it).
vi.mock("@/lib/memory", () => ({
  recallMemories: vi.fn().mockResolvedValue([]),
  saveMemory: vi.fn().mockResolvedValue({ id: "m1", deduped: false }),
}));

import { executeToolCall } from "@/lib/pipeline/executor";
import { runAssistant } from "@/lib/pipeline/run";

const profile: Profile = { id: "u1", display_name: "Ori", timezone: "UTC", settings: {}, onboarded_at: null };
const provider = { name: "fake", chat: vi.fn() } as unknown as AIProvider;
const ctx = { supabase: {} as SupabaseClient, provider, profile };

describe("A3 — complete_task surfaces a failed update instead of a fake success", () => {
  it("returns an error result and no receipt when the update fails", async () => {
    const supabase = {
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.is = () => b;
        b.ilike = () => b;
        b.limit = () => Promise.resolve({ data: [{ id: "t1", title: "Call lab" }], error: null });
        b.update = () => ({ eq: () => Promise.resolve({ error: { message: "RLS denied" } }) });
        return b;
      },
    } as unknown as SupabaseClient;

    const outcome = await executeToolCall({ ...ctx, supabase }, {
      id: "1", name: "complete_task", arguments: { title_query: "lab" },
    });
    expect(outcome.result).toMatch(/^Error:/);
    expect(outcome.result).toContain("RLS denied");
    expect(outcome.receipt).toBeUndefined();
  });
});

describe("executor — a failed insert produces a failure, not a success receipt", () => {
  it("schedule_reminder reports the DB error", async () => {
    const supabase = {
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "insert boom" } }) }) }),
      }),
    } as unknown as SupabaseClient;

    const outcome = await executeToolCall({ ...ctx, supabase }, {
      id: "1", name: "schedule_reminder", arguments: { message: "x", remind_at: "2026-07-28T16:00:00-04:00" },
    });
    expect(outcome.result).toMatch(/^Error:/);
    expect(outcome.receipt).toBeUndefined();
  });
});

describe("A4 — runAssistant reports tool failures deterministically", () => {
  it("attaches a failure the model's wording can't hide", async () => {
    const supabase = {
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }),
      }),
    } as unknown as SupabaseClient;

    const scripted = {
      name: "fake",
      chat: vi
        .fn()
        // hop 0: the model calls a tool that will fail
        .mockResolvedValueOnce({ text: "", toolCalls: [{ id: "1", name: "create_task", arguments: { title: "Buy milk" } }] })
        // hop 1: the model claims success anyway
        .mockResolvedValueOnce({ text: "Done! Added it.", toolCalls: [] }),
    } as unknown as AIProvider;

    const res = await runAssistant(supabase, scripted, profile, "buy milk");
    expect(res.failures).toBeDefined();
    expect(res.failures!).toHaveLength(1);
    expect(res.failures![0]).toMatchObject({ tool: "create_task", message: "boom" });
  });
});
