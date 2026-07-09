"use client";

import { useState } from "react";
import { Card } from "./ui";
import { cn } from "@/lib/utils";

export function ReadinessCard({ score, reasons }: { score: number; reasons: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const color = score >= 75 ? "text-good" : score >= 45 ? "text-accent" : "text-bad";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-dim">
            Today's readiness
          </p>
          <p className={cn("tabular mt-1 text-3xl font-semibold", color)}>{score}%</p>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-text-dim hover:text-text hover:underline"
        >
          {expanded ? "Hide" : "How is this calculated?"}
        </button>
      </div>
      {expanded && (
        <ul className="mt-3 flex flex-col gap-1 border-t pt-3 text-xs text-text-dim">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
