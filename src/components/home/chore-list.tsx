"use client";

import { useOptimistic, useTransition } from "react";
import { HouseholdMember } from "@/lib/types";
import { archiveChore, completeChore } from "@/app/(app)/home/actions";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, string> = {
  kitchen: "🍳", bathroom: "🛁", bedroom: "🛏", living: "🛋", laundry: "🧺",
  outdoor: "🌿", pets: "🐾", plants: "🪴", maintenance: "🔧", errand: "🧾", other: "🏠",
};

export interface ChoreRow {
  id: string;
  title: string;
  category: string;
  cadence: string;
  overdueDays: number;
  assignee: HouseholdMember | null;
}

/** Satisfying check-list — checking writes a completion (rotation advances immediately). */
export function ChoreList({ chores }: { chores: ChoreRow[] }) {
  const [, startTransition] = useTransition();
  // Checked or removed chores vanish immediately; the server's revalidated
  // list (with rotation advanced) replaces this when it lands.
  const [optimisticChores, removeChore] = useOptimistic(chores, (state: ChoreRow[], id: string) =>
    state.filter((c) => c.id !== id),
  );

  if (optimisticChores.length === 0) {
    return <p className="text-sm text-text-dim">All done — the house is happy ☕</p>;
  }

  return (
    <ul className="flex flex-col">
      {optimisticChores.map((c) => (
        <li key={c.id} className="group flex items-center gap-3 border-b py-2.5 last:border-b-0">
          <button
            aria-label={`Complete ${c.title}`}
            onClick={() =>
              startTransition(() => {
                removeChore(c.id);
                return completeChore(c.id, c.assignee?.id ?? null);
              })
            }
            className="transition-fast flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border hover:border-accent"
          />
          <span aria-hidden className="shrink-0">{CATEGORY_ICONS[c.category] ?? "🏠"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{c.title}</p>
            <p className="text-xs text-text-dim">
              {c.cadence.replace("_", "-")}
              {c.overdueDays > 0 && <span className="text-bad"> · {c.overdueDays}d overdue</span>}
            </p>
          </div>
          {c.assignee && (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ backgroundColor: c.assignee.color }}
              title={c.assignee.name}
            >
              {c.assignee.initial}
            </span>
          )}
          <button
            aria-label="Remove chore"
            onClick={() =>
              startTransition(() => {
                removeChore(c.id);
                return archiveChore(c.id);
              })
            }
            className={cn("transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100")}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
