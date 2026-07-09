"use client";

import { useMemo, useState } from "react";
import { Card, CardTitle } from "@/components/ui";
import { simulate, SimulationInput } from "@/lib/finance/simulate";
import { money, moneyDelta } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

/**
 * Flagship What-If: sliders over the same simulate() the AI tool uses, so
 * dragging a slider and asking the assistant give identical projections.
 * Pure client-side math over data fetched once — instant.
 */
export function WhatIfSimulator({ input }: { input: SimulationInput }) {
  const [extraSavings, setExtraSavings] = useState(0);
  const [incomeChange, setIncomeChange] = useState(0);
  const [expenseChange, setExpenseChange] = useState(0);
  const [purchase, setPurchase] = useState(0);

  const result = useMemo(
    () =>
      simulate(input, {
        extraMonthlySavings: extraSavings,
        incomeChange,
        expenseChange,
        oneTimePurchase: purchase,
      }),
    [input, extraSavings, incomeChange, expenseChange, purchase],
  );

  const changed = extraSavings !== 0 || incomeChange !== 0 || expenseChange !== 0 || purchase !== 0;
  const { before, after } = result;

  return (
    <Card>
      <CardTitle>What if…</CardTitle>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Slider label="Save more each month" value={extraSavings} min={-500} max={2000} step={50} onChange={setExtraSavings} format={(v) => moneyDelta(v) + "/mo"} />
          <Slider label="Income change" value={incomeChange} min={-2000} max={3000} step={100} onChange={setIncomeChange} format={(v) => moneyDelta(v) + "/mo"} />
          <Slider label="New recurring expenses" value={expenseChange} min={-1000} max={2000} step={50} onChange={setExpenseChange} format={(v) => moneyDelta(v) + "/mo"} />
          <Slider label="One-time purchase" value={purchase} min={0} max={10000} step={100} onChange={setPurchase} format={(v) => money(v)} />
          {changed && (
            <button onClick={() => { setExtraSavings(0); setIncomeChange(0); setExpenseChange(0); setPurchase(0); }} className="self-start text-xs text-text-dim hover:underline">
              Reset
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Delta label="Monthly net" before={money(before.monthlyNet)} after={money(after.monthlyNet)} good={after.monthlyNet >= before.monthlyNet} changed={changed} />
          <Delta label="Cash in 12 months" before={money(before.cashIn12Months)} after={money(after.cashIn12Months)} good={after.cashIn12Months >= before.cashIn12Months} changed={changed} />
          <Delta label="Health score" before={`${before.healthScore}`} after={`${after.healthScore}`} good={after.healthScore >= before.healthScore} changed={changed} />
          {before.goals.map((g, i) => {
            const a = after.goals[i]!;
            return (
              <Delta
                key={g.goalId}
                label={`"${g.title}" done`}
                before={g.estimatedCompletion ?? "no ETA"}
                after={a.estimatedCompletion ?? "no ETA"}
                good={(a.monthsToTarget ?? Infinity) <= (g.monthsToTarget ?? Infinity)}
                changed={changed}
              />
            );
          })}
          <CashCurve before={before.cashCurve.map((p) => p.cash)} after={after.cashCurve.map((p) => p.cash)} changed={changed} />
        </div>
      </div>
    </Card>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tabular text-xs text-text-dim">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[var(--accent)]"
      />
    </label>
  );
}

function Delta({ label, before, after, good, changed }: {
  label: string; before: string; after: string; good: boolean; changed: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-text-dim">{label}</span>
      <span className="tabular">
        {changed && before !== after ? (
          <>
            <span className="text-text-dim line-through">{before}</span>{" "}
            <span className={good ? "text-good" : "text-bad"}>{after}</span>
          </>
        ) : (
          before
        )}
      </span>
    </div>
  );
}

function CashCurve({ before, after, changed }: { before: number[]; after: number[]; changed: boolean }) {
  const all = [...before, ...after];
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 1);
  const range = max - min || 1;
  const w = 280;
  const h = 56;
  const toPoints = (values: number[]) =>
    values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 6) - 3).toFixed(1)}`).join(" ");

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-dim">Cash, next 12 months</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none" aria-hidden>
        {min < 0 && (
          <line x1="0" x2={w} y1={h - ((0 - min) / range) * (h - 6) - 3} y2={h - ((0 - min) / range) * (h - 6) - 3} stroke="var(--bad)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        )}
        <polyline points={toPoints(before)} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" opacity={changed ? 0.4 : 1} />
        {changed && <polyline points={toPoints(after)} fill="none" stroke="var(--accent)" strokeWidth="2" />}
      </svg>
      <p className={cn("mt-1 text-xs text-text-dim", !changed && "invisible")}>Grey = today's path · orange = with your changes</p>
    </div>
  );
}
