import { requireUser } from "@/lib/supabase/server";
import { fetchWorkspaces } from "@/lib/workspaces/data";
import { Note } from "@/lib/types";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { NoteCard } from "@/components/note-card";
import { createNote } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const { supabase, user } = await requireUser();
  const [{ data }, workspaces] = await Promise.all([
    supabase
      .from("notes")
      .select("*")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(100),
    fetchWorkspaces(supabase, user.id),
  ]);
  const notes = (data ?? []) as Note[];
  const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Notes"
        action={
          <form action={createNote.bind(null, null)}>
            <Button type="submit" size="sm">
              New note
            </Button>
          </form>
        }
      />

      {notes.length === 0 ? (
        <EmptyState
          title="A blank page, a full pot"
          hint="Notes live here and inside workspaces. Create one, or press ⌘K anywhere."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} workspace={n.workspace_id ? workspaceName.get(n.workspace_id) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
