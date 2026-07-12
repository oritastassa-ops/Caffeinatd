import { SupabaseClient } from "@supabase/supabase-js";
import { AIConversation, Note, Task, Workspace, WorkspaceKind } from "@/lib/types";

/**
 * Seeded on first visit so the workspace system never starts empty. These are
 * real rows the user can rename/archive — not fake data.
 */
const DEFAULT_WORKSPACES: { slug: string; name: string; kind: WorkspaceKind; icon: string; description: string }[] = [
  { slug: "development", name: "Development", kind: "development", icon: "⌘", description: "Code, repos, and shipping" },
  { slug: "university", name: "University", kind: "university", icon: "◉", description: "Courses, assignments, exams" },
  { slug: "research", name: "Research", kind: "research", icon: "❖", description: "Papers, experiments, questions" },
  { slug: "personal", name: "Personal", kind: "personal", icon: "◈", description: "Life admin and everything else" },
];

/** All active workspaces, seeding the defaults if the user has none yet. */
export async function fetchWorkspaces(
  supabase: SupabaseClient,
  userId: string,
): Promise<Workspace[]> {
  const { data } = await supabase
    .from("workspaces")
    .select("*")
    .is("archived_at", null)
    .order("sort_order")
    .order("created_at");
  if (data && data.length > 0) return data as Workspace[];

  // First visit (or all archived — check before seeding to avoid resurrection).
  const { count } = await supabase
    .from("workspaces")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return [];

  const rows = DEFAULT_WORKSPACES.map((w, i) => ({ ...w, user_id: userId, sort_order: i }));
  const { data: seeded } = await supabase.from("workspaces").insert(rows).select();
  return (seeded ?? []) as Workspace[];
}

export interface WorkspaceContext {
  workspace: Workspace;
  openTasks: Task[];
  doneTasks: Task[];
  notes: Note[];
  conversations: AIConversation[];
  /** Distinct task.project values inside this workspace — lightweight "projects" until they grow their own table. */
  projects: { name: string; open: number; done: number }[];
}

/** Everything a workspace surfaces on open — one round of parallel queries. */
export async function fetchWorkspaceContext(
  supabase: SupabaseClient,
  workspace: Workspace,
): Promise<WorkspaceContext> {
  const [{ data: tasks }, { data: notes }, { data: conversations }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("priority")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from("notes")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("ai_conversations")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const all = (tasks ?? []) as Task[];
  const projects = new Map<string, { open: number; done: number }>();
  for (const t of all) {
    if (!t.project) continue;
    const p = projects.get(t.project) ?? { open: 0, done: 0 };
    p[t.completed_at ? "done" : "open"] += 1;
    projects.set(t.project, p);
  }

  return {
    workspace,
    openTasks: all.filter((t) => !t.completed_at),
    doneTasks: all.filter((t) => t.completed_at).slice(0, 10),
    notes: (notes ?? []) as Note[],
    conversations: (conversations ?? []) as AIConversation[],
    projects: [...projects.entries()].map(([name, c]) => ({ name, ...c })),
  };
}
