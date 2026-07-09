"use client";

import { useState, useTransition } from "react";
import { Insight } from "@/lib/types";
import { dismissInsight } from "@/app/(app)/insights-actions";
import { Card, CardTitle, EmptyState } from "./ui";
import { cn } from "@/lib/utils";
import { OPEN_COMMAND_BAR_EVENT } from "./command-bar";

const DOMAIN_LINK: Record<string, string> = {
  fitness: "/fitness",
  nutrition: "/nutrition",
  calendar: "/calendar",
  tasks: "/tasks",
  sleep: "/",
  finance: "/finance",
  home: "/home",
};

export function InsightsCard({ insights }: { insights: Insight[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const visible = insights.filter((i) => !dismissed.has(i.id));

  return (
    <Card>
      <CardTitle>Smart suggestions</CardTitle>
      {visible.length === 0 ? (
        <EmptyState hint="Nothing stands out right now — you're on track." />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((i) => (
            <li key={i.id} className="group flex items-start gap-3 rounded-lg border bg-surface-2 p-3">
              <span
                className={cn(
                  "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  i.importance >= 4 ? "bg-bad" : i.importance >= 3 ? "bg-accent" : "bg-text-dim",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{i.message}</p>
                <p className="mt-0.5 text-xs text-text-dim">{i.reason}</p>
              </div>
              {i.action_preset ? (
                <button
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_BAR_EVENT, { detail: i.action_preset }))
                  }
                  className="shrink-0 text-xs font-medium text-accent opacity-0 hover:underline group-hover:opacity-100"
                >
                  Do it
                </button>
              ) : (
                <a
                  href={DOMAIN_LINK[i.domain] ?? "/"}
                  className="shrink-0 text-xs font-medium text-accent opacity-0 hover:underline group-hover:opacity-100"
                >
                  View
                </a>
              )}
              <button
                aria-label="Dismiss"
                onClick={() => {
                  setDismissed((s) => new Set(s).add(i.id));
                  startTransition(() => dismissInsight(i.id));
                }}
                className="transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
