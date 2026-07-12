import Link from "next/link";
import { Note } from "@/lib/types";
import { relativeTime } from "@/lib/utils";

/** Compact note preview — used on /notes, workspace pages, and the dashboard. */
export function NoteCard({ note, workspace }: { note: Note; workspace?: string }) {
  const preview = note.content.replace(/[#*`>\-]/g, "").trim().slice(0, 140);
  return (
    <Link
      href={`/notes/${note.id}`}
      className="transition-fast group flex flex-col gap-1.5 rounded-xl border bg-surface p-4 hover:border-accent"
    >
      <div className="flex items-center gap-2">
        {note.pinned && <span aria-hidden className="text-xs text-accent">★</span>}
        <span className="truncate text-sm font-medium">{note.title || "Untitled"}</span>
      </div>
      {preview && <p className="line-clamp-2 text-[13px] leading-relaxed text-text-dim">{preview}</p>}
      <p className="mt-auto flex gap-2 pt-1 text-[11px] text-text-dim">
        <span className="tabular">{relativeTime(note.updated_at)}</span>
        {workspace && <span className="rounded bg-surface-2 px-1.5">{workspace}</span>}
      </p>
    </Link>
  );
}
