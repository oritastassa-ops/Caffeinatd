import Link from "next/link";
import { Card, CardTitle } from "@/components/ui";
import { NoteCard } from "@/components/note-card";
import { Note } from "@/lib/types";

/** The three most recently touched notes, with a jump to the full list. */
export function QuickNotes({ notes }: { notes: Note[] }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <CardTitle>Quick notes</CardTitle>
        <Link href="/notes" className="text-xs text-accent hover:underline">
          All notes →
        </Link>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-text-dim">
          No notes yet —{" "}
          <Link href="/notes" className="text-accent hover:underline">
            start one
          </Link>{" "}
          or capture above.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </Card>
  );
}
