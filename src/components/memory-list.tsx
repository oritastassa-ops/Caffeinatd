"use client";

import { useState, useTransition } from "react";
import { Memory } from "@/lib/types";
import { deleteMemory, editMemory } from "@/app/(app)/memory/actions";

export function MemoryList({ memories }: { memories: Memory[] }) {
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(m: Memory) {
    setEditingId(m.id);
    setDraft(m.content);
  }

  function save(id: string) {
    startTransition(() => editMemory(id, draft));
    setEditingId(null);
  }

  return (
    <ul className="flex flex-col">
      {memories.map((m) => (
        <li key={m.id} className="group flex items-start gap-3 border-b py-2.5 text-sm last:border-b-0">
          {editingId === m.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save(m.id)}
              onBlur={() => save(m.id)}
              className="flex-1 rounded-md border bg-surface-2 px-2 py-1 text-sm outline-none focus:border-accent"
            />
          ) : (
            <button
              onClick={() => startEdit(m)}
              className="min-w-0 flex-1 text-left hover:underline"
              title="Click to edit"
            >
              {m.content}
            </button>
          )}
          <span className="tabular shrink-0 text-xs text-text-dim" title="Last updated">
            {m.updated_at.slice(0, 10)}
          </span>
          <button
            aria-label="Forget this"
            onClick={() => startTransition(() => deleteMemory(m.id))}
            className="transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
