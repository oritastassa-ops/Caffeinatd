"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { HealthFactor } from "@/lib/finance/health";
import { cn } from "@/lib/utils";

/** Same explainability pattern as the readiness card: the score is expandable, never a black box. */
export function FinanceHealthCard({ score, factors }: { score: number; factors: HealthFactor[] }) {
  const [expanded, setExpanded] = useState(false);
  const color = score >= 75 ? "text-good" : score >= 45 ? "text-accent" : "text-bad";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-dim">
            Financial health
          </p>
          <p className={cn("tabular mt-1 text-3xl font-semibold", color)}>{score}</p>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-text-dim hover:text-text hover:underline"
        >
          {expanded ? "Hide" : "How is this calculated?"}
        </button>
      </div>
      {expanded && (
        <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
          {factors.map((f) => (
            <li key={f.name} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{f.name}</span>
                <span className="tabular text-text-dim">
                  {f.earned}/{f.max}
                </span>
              </div>
              <p className="mt-0.5 text-text-dim">{f.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
