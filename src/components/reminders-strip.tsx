"use client";

import { useTransition } from "react";
import { Reminder } from "@/lib/types";
import { completeReminder } from "@/app/(app)/reminders-actions";

export function RemindersStrip({ reminders, tz }: { reminders: Reminder[]; tz: string }) {
  const [, startTransition] = useTransition();
  if (reminders.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {reminders.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm"
        >
          <span aria-hidden>⏰</span>
          <span className="flex-1">{r.message}</span>
          <span className="tabular text-xs text-text-dim">
            {new Date(r.remind_at).toLocaleTimeString("en-US", {
              timeZone: tz,
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <button
            onClick={() => startTransition(() => completeReminder(r.id))}
            className="text-xs font-medium text-accent hover:underline"
          >
            Done
          </button>
        </div>
      ))}
    </div>
  );
}
