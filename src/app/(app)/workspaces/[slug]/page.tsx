import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { fetchWorkspaceContext } from "@/lib/workspaces/data";
import { Workspace } from "@/lib/types";
import { Button, Card, CardTitle, EmptyState, Input } from "@/components/ui";
import { TaskList } from "@/components/task-list";
import { NoteCard } from "@/components/note-card";
import { QuickCapture } from "@/components/quick-capture";
import { addTask } from "@/app/(app)/tasks/actions";
import { createNote } from "@/app/(app)/notes/actions";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * A workspace is a context, not a page: everything scoped to it — tasks,
 * projects, notes, conversations — surfaces here without manual gathering.
 */
export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();
  if (!data) notFound();

  const ctx = await fetchWorkspaceContext(supabase, data as Workspace);
  const { workspace, openTasks, doneTasks, notes, conversations, projects } = ctx;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="card-enter flex items-center gap-3">
        <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-card bg-accent-soft text-lg text-accent">
          {workspace.icon}
        </span>
        <div className="min-w-0">
          <h1 className="text-title font-semibold tracking-tight">{workspace.name}</h1>
          {workspace.description && <p className="text-sm text-text-dim">{workspace.description}</p>}
        </div>
      </div>

      <QuickCapture workspaceId={workspace.id} />

      {/* ── Projects strip (derived from task.project until they grow a table) */}
      {projects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <span key={p.name} className="flex items-center gap-2 rounded-xl border bg-surface px-3 py-1.5 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="tabular text-xs text-text-dim">
                {p.open} open{p.done > 0 && ` · ${p.done} done`}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* ── Tasks ─────────────────────────────────────────────────────── */}
        <Card>
          <CardTitle>Tasks · {openTasks.length}</CardTitle>
          <form action={addTask} className="mb-3 flex items-end gap-2">
            <input type="hidden" name="workspace_id" value={workspace.id} />
            <Input
              name="title"
              aria-label={`Add a task to ${workspace.name}`}
              placeholder={`Add to ${workspace.name}…`}
              autoComplete="off"
              containerClassName="flex-1"
            />
            <Button type="submit" size="sm">
              Add
            </Button>
          </form>
          {openTasks.length === 0 ? (
            <p className="text-sm text-text-dim">Nothing open in this workspace.</p>
          ) : (
            <TaskList tasks={openTasks} />
          )}
          {doneTasks.length > 0 && (
            <p className="mt-3 text-xs text-text-dim">{doneTasks.length} recently completed</p>
          )}
        </Card>

        {/* ── Recent conversations ──────────────────────────────────────── */}
        <Card>
          <CardTitle>Recent conversations</CardTitle>
          {conversations.length === 0 ? (
            <p className="text-sm text-text-dim">
              Assistant exchanges scoped to this workspace will appear here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {conversations.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="text-accent">✦</span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="tabular shrink-0 text-xs text-text-dim">{relativeTime(c.updated_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Notes ───────────────────────────────────────────────────────── */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Notes</CardTitle>
          <form action={createNote.bind(null, workspace.id)}>
            <Button type="submit" variant="secondary" size="sm">
              New note
            </Button>
          </form>
        </div>
        {notes.length === 0 ? (
          <EmptyState hint={`No notes in ${workspace.name} yet — capture thinking as you go.`} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
