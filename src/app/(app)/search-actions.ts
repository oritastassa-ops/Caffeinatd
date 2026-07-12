"use server";

import { requireUser } from "@/lib/supabase/server";

export interface SearchResult {
  kind: "task" | "note" | "workspace" | "memory" | "conversation";
  id: string;
  title: string;
  sub?: string;
  href: string;
}

/** Escape LIKE wildcards; also strip PostgREST or-syntax separators, which
 * can't be escaped inside an `.or()` filter string. */
function likePattern(q: string): string {
  return `%${q.replace(/[%_]/g, "\\$&").replace(/[,()]/g, " ")}%`;
}

/**
 * One query, everything: tasks, notes, workspaces, memories, conversations.
 * Deliberately capped per source so the palette stays scannable — this is
 * recall, not a search results page.
 */
export async function universalSearch(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { supabase } = await requireUser();
  const like = likePattern(q);

  const [tasks, notes, workspaces, memories, conversations] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, due_at")
      .is("completed_at", null)
      .ilike("title", like)
      .limit(5),
    supabase
      .from("notes")
      .select("id, title, content")
      .or(`title.ilike.${like},content.ilike.${like}`)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("workspaces")
      .select("id, slug, name, icon")
      .is("archived_at", null)
      .ilike("name", like)
      .limit(3),
    supabase.from("memories").select("id, kind, content").ilike("content", like).limit(3),
    supabase
      .from("ai_conversations")
      .select("id, title")
      .ilike("title", like)
      .order("updated_at", { ascending: false })
      .limit(3),
  ]);

  return [
    ...(workspaces.data ?? []).map((w) => ({
      kind: "workspace" as const,
      id: w.id,
      title: w.name,
      sub: "Workspace",
      href: `/workspaces/${w.slug}`,
    })),
    ...(tasks.data ?? []).map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      sub: t.due_at ? `Task · due ${t.due_at.slice(0, 10)}` : "Task",
      href: "/tasks",
    })),
    ...(notes.data ?? []).map((n) => ({
      kind: "note" as const,
      id: n.id,
      title: n.title || "Untitled",
      sub: n.content ? `Note · ${n.content.slice(0, 60)}` : "Note",
      href: `/notes/${n.id}`,
    })),
    ...(conversations.data ?? []).map((c) => ({
      kind: "conversation" as const,
      id: c.id,
      title: c.title,
      sub: "AI conversation",
      href: "/memory",
    })),
    ...(memories.data ?? []).map((m) => ({
      kind: "memory" as const,
      id: m.id,
      title: m.content,
      sub: `Memory · ${m.kind}`,
      href: "/memory",
    })),
  ];
}
