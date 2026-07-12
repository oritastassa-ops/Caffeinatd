"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Capture } from "@/lib/types";
import { addCapture, captureToTask, resolveCapture } from "@/app/(app)/capture-actions";
import { cn, relativeTime } from "@/lib/utils";

/**
 * Quick Capture: one input, natural language, zero ceremony. Saves to the
 * capture inbox; triage happens later (inline below, or via the assistant).
 */
export function QuickCapture({ workspaceId, className }: { workspaceId?: string; className?: string }) {
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit() {
    const text = value.trim();
    if (!text || pending) return;
    setValue(""); // optimistic — the input is ready for the next thought immediately
    startTransition(async () => {
      await addCapture(text, workspaceId);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
      router.refresh();
    });
  }

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder='Capture anything… "review TP53 paper tomorrow"'
        aria-label="Quick capture"
        className="w-full rounded-xl border bg-surface px-4 py-2.5 pr-16 text-sm outline-none placeholder:text-text-dim focus:border-accent"
      />
      <span
        aria-live="polite"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs",
          flash ? "text-good" : "text-text-dim",
        )}
      >
        {flash ? "✓ Captured" : "↵"}
      </span>
    </div>
  );
}

/** Inbox triage strip: promote to task, or dismiss. Renders nothing when empty. */
export function CaptureInbox({ captures }: { captures: Capture[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());

  const visible = captures.filter((c) => !gone.has(c.id));
  if (visible.length === 0) return null;

  function act(id: string, fn: () => Promise<void>) {
    setGone((s) => new Set(s).add(id)); // optimistic removal
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {visible.map((c) => (
        <li
          key={c.id}
          className="flex items-center gap-2 rounded-lg border border-dashed bg-surface px-3 py-1.5 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">{c.content}</span>
          <span className="tabular shrink-0 text-[11px] text-text-dim">{relativeTime(c.created_at)}</span>
          <button
            onClick={() => act(c.id, () => captureToTask(c.id, c.content))}
            className="transition-fast shrink-0 text-xs font-medium text-accent hover:underline"
          >
            → Task
          </button>
          <button
            onClick={() => act(c.id, () => resolveCapture(c.id, "dismissed"))}
            aria-label="Dismiss capture"
            className="transition-fast shrink-0 text-xs text-text-dim hover:text-bad"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
