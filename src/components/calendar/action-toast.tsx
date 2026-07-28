"use client";

import { useEffect, useState } from "react";

export interface ToastState {
  label: string;
  /** Present only for undoable actions (event creation). */
  undo?: { calendarId: string; calendarEventId: string };
}

/**
 * A single confirmation toast for a calendar mutation. Mirrors the assistant's
 * receipt chips: a ✓ appears only after the server action actually succeeded,
 * and Undo posts to the same /api/assistant/undo endpoint. Auto-dismisses.
 */
export function ActionToast({
  toast,
  onDismiss,
  onUndone,
}: {
  toast: ToastState;
  onDismiss: () => void;
  onUndone: () => void;
}) {
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss, toast]);

  async function undo() {
    if (!toast.undo || busy) return;
    setBusy(true);
    const res = await fetch("/api/assistant/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toast.undo),
    });
    setBusy(false);
    if (res.ok) {
      setUndone(true);
      onUndone();
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bubble-in fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-pill border bg-surface px-4 py-2 text-sm shadow-overlay"
    >
      <span className={undone ? "text-text-dim line-through" : ""}>
        <span className="mr-1.5 text-good">✓</span>
        {toast.label}
      </span>
      {toast.undo && !undone && (
        <button onClick={undo} disabled={busy} className="font-medium text-accent hover:underline disabled:opacity-50">
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
      {undone && <span className="text-xs text-text-dim">Undone</span>}
    </div>
  );
}
