"use client";

import { useTransition } from "react";
import { GoalForecast } from "@/lib/finance/forecast";
import { money } from "@/lib/finance/format";
import { deleteGoal } from "@/app/(app)/finance/actions";
import { cn } from "@/lib/utils";

export function GoalsList({ forecasts }: { forecasts: GoalForecast[] }) {
  const [, startTransition] = useTransition();

  if (forecasts.length === 0) {
    return (
      <p className="text-sm text-text-dim">
        No goals yet — try ⌘K: &ldquo;create a goal to save $10,000 for an emergency fund&rdquo;.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {forecasts.map((f) => (
        <li key={f.goalId} className="group">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {f.title}
              {f.onTrackForDeadline === false && (
                <span className="ml-2 rounded bg-bad/10 px-1.5 py-0.5 text-[10px] font-medium text-bad">
                  behind deadline
                </span>
              )}
            </span>
            <span className="tabular text-xs text-text-dim">
              {money(f.currentAmount)} / {money(f.targetAmount)}
              <button
                onClick={() => startTransition(() => deleteGoal(f.goalId))}
                className="transition-fast ml-2 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
                aria-label="Delete goal"
              >
                ✕
              </button>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                "h-full rounded-full transition-fast",
                f.onTrackForDeadline === false ? "bg-bad" : "bg-accent",
              )}
              style={{ width: `${f.progressPercent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-text-dim">
            {f.progressPercent}%
            {f.estimatedCompletion
              ? ` · done ~${f.estimatedCompletion}`
              : f.monthsToTarget === 0
                ? " · funded 🎉"
                : " · no ETA at the current pace"}
          </p>
        </li>
      ))}
    </ul>
  );
}
