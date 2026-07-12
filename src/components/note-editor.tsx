"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Note, Workspace } from "@/lib/types";
import { deleteNote, saveNote } from "@/app/(app)/notes/actions";
import { cn, relativeTime } from "@/lib/utils";

type SaveState = "saved" | "dirty" | "saving";

/**
 * Distraction-free note editor: big title, plain markdown body, debounced
 * autosave. No toolbar — the point is to write, not to format.
 */
export function NoteEditor({ note, workspaces }: { note: Note; workspaces: Workspace[] }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [pinned, setPinned] = useState(note.pinned);
  const [workspaceId, setWorkspaceId] = useState(note.workspace_id ?? "");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const flush = useCallback(
    async (patch: { title?: string; content?: string; pinned?: boolean; workspace_id?: string | null }) => {
      setSaveState("saving");
      await saveNote(note.id, patch);
      setSaveState("saved");
    },
    [note.id],
  );

  // Debounced autosave for the typed fields; toggles save immediately.
  function queueSave(next: { title?: string; content?: string }) {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 600);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Grow the textarea with its content so the page scrolls, not the box.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-text-dim">
        <select
          value={workspaceId}
          aria-label="Workspace"
          onChange={(e) => {
            setWorkspaceId(e.target.value);
            flush({ workspace_id: e.target.value || null });
          }}
          className="rounded-lg border bg-surface px-2 py-1 outline-none focus:border-accent"
        >
          <option value="">No workspace</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setPinned((p) => !p);
            flush({ pinned: !pinned });
          }}
          className={cn(
            "transition-fast rounded-lg border px-2 py-1",
            pinned ? "border-accent bg-accent-soft text-accent" : "hover:border-accent hover:text-accent",
          )}
        >
          {pinned ? "★ Pinned" : "☆ Pin"}
        </button>
        <span className="ml-auto tabular">
          {saveState === "saved" && `Saved · edited ${relativeTime(note.updated_at)}`}
          {saveState === "dirty" && "…"}
          {saveState === "saving" && "Saving…"}
        </span>
        <button
          onClick={() => deleteNote(note.id)}
          className="transition-fast rounded-lg border px-2 py-1 text-text-dim hover:border-bad hover:text-bad"
        >
          Delete
        </button>
      </div>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          queueSave({ title: e.target.value });
        }}
        placeholder="Untitled"
        aria-label="Note title"
        className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-text-dim/50"
      />

      <textarea
        ref={bodyRef}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          queueSave({ content: e.target.value });
        }}
        placeholder="Write in markdown…"
        aria-label="Note body"
        rows={12}
        className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-text-dim/50"
      />
    </div>
  );
}
