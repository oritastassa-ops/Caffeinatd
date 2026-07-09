"use client";

import { useOptimistic, useTransition } from "react";
import { Task } from "@/lib/types";
import { PriorityBadge } from "./ui";
import { toggleTask, deleteTask } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/utils";

type TaskAction = { type: "toggle"; id: string; done: boolean } | { type: "delete"; id: string };

export function TaskList({ tasks }: { tasks: Task[] }) {
  const [, startTransition] = useTransition();
  // Checkbox responds on click, not after the server round-trip; the
  // revalidated server state replaces the optimistic one when it lands.
  const [optimisticTasks, apply] = useOptimistic(tasks, (state: Task[], action: TaskAction) => {
    if (action.type === "delete") return state.filter((t) => t.id !== action.id);
    return state.map((t) =>
      t.id === action.id ? { ...t, completed_at: action.done ? new Date().toISOString() : null } : t,
    );
  });

  return (
    <ul className="flex flex-col">
      {optimisticTasks.map((t) => {
        const done = Boolean(t.completed_at);
        return (
          <li
            key={t.id}
            className="group flex items-center gap-3 border-b py-2.5 last:border-b-0"
          >
            <button
              aria-label={done ? "Mark incomplete" : "Mark complete"}
              onClick={() =>
                startTransition(() => {
                  apply({ type: "toggle", id: t.id, done: !done });
                  return toggleTask(t.id, !done);
                })
              }
              className={cn(
                "transition-fast flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border text-[11px]",
                done ? "border-good bg-good text-white" : "hover:border-accent",
              )}
            >
              {done && "✓"}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", done && "text-text-dim line-through")}>
                {t.title}
              </p>
              {(t.category || t.project) && (
                <p className="text-xs text-text-dim">{[t.project, t.category].filter(Boolean).join(" · ")}</p>
              )}
            </div>
            {t.due_at && !done && (
              <span className="tabular shrink-0 text-xs text-text-dim">{t.due_at.slice(5, 10)}</span>
            )}
            <PriorityBadge priority={t.priority} />
            <button
              aria-label="Delete task"
              onClick={() =>
                startTransition(() => {
                  apply({ type: "delete", id: t.id });
                  return deleteTask(t.id);
                })
              }
              className="transition-fast text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}
