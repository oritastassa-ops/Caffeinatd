"use client";

import { useState } from "react";
import { ActionReceipt, AssistantResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type ConfirmState = "pending" | "remembered" | "declined";

/**
 * Action receipts for one assistant response: undoable ✓ chips, Remember /
 * Don't-remember confirmations, and deterministic failure chips. Extracted
 * from the command bar so the floating companion renders the same receipts.
 */
export function ReceiptChips({ response }: { response: AssistantResponse }) {
  const [undone, setUndone] = useState<Set<number>>(new Set());
  const [confirmStates, setConfirmStates] = useState<Record<number, ConfirmState>>({});

  async function undo(action: ActionReceipt, index: number) {
    if (!action.undo || undone.has(index)) return;
    const res = await fetch("/api/assistant/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action.undo),
    });
    if (res.ok) setUndone((s) => new Set(s).add(index));
  }

  async function remember(action: ActionReceipt, index: number) {
    if (!action.confirm) return;
    const res = await fetch("/api/assistant/confirm-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action.confirm),
    });
    setConfirmStates((s) => ({ ...s, [index]: res.ok ? "remembered" : "pending" }));
  }

  function decline(index: number) {
    setConfirmStates((s) => ({ ...s, [index]: "declined" }));
  }

  if (response.actions.length === 0 && (response.failures?.length ?? 0) === 0) return null;

  return (
    <>
      {response.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {response.actions.map((a, i) =>
            a.confirm ? (
              <span
                key={i}
                className={cn(
                  "transition-fast inline-flex items-center gap-2 rounded-lg border bg-surface-2 px-2.5 py-1 text-xs",
                  confirmStates[i] === "declined" && "line-through opacity-50",
                )}
              >
                <span className="text-accent">?</span>
                {a.label}
                {(!confirmStates[i] || confirmStates[i] === "pending") && (
                  <>
                    <button onClick={() => remember(a, i)} className="font-medium text-accent hover:underline">
                      Remember
                    </button>
                    <button onClick={() => decline(i)} className="text-text-dim hover:underline">
                      Don&apos;t remember
                    </button>
                  </>
                )}
                {confirmStates[i] === "remembered" && <span className="text-good">✓ Remembered</span>}
              </span>
            ) : (
              <span
                key={i}
                className={cn(
                  "transition-fast inline-flex items-center gap-2 rounded-lg border bg-surface-2 px-2.5 py-1 text-xs",
                  undone.has(i) && "line-through opacity-50",
                )}
              >
                <span className="text-good">✓</span>
                {a.label}
                {a.undo && !undone.has(i) && (
                  <button onClick={() => undo(a, i)} className="font-medium text-accent hover:underline">
                    Undo
                  </button>
                )}
              </span>
            ),
          )}
        </div>
      )}
      {(response.failures?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {response.failures!.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-1 text-xs text-bad"
            >
              <span aria-hidden>⚠</span>
              <span className="min-w-0">
                <span className="font-medium">{f.tool.replace(/_/g, " ")}</span> failed — {f.message}
              </span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
