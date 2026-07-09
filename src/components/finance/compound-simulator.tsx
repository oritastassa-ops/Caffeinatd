"use client";

import { useMemo, useState } from "react";
import { Card, CardTitle } from "@/components/ui";
import { computeCompound } from "@/lib/finance/compound";
import { money } from "@/lib/finance/format";

/** Compound-interest playground — instant, deterministic, contribution/growth split chart. */
export function CompoundSimulator() {
  const [initial, setInitial] = useState(1000);
  const [monthly, setMonthly] = useState(300);
  const [years, setYears] = useState(20);
  const [returnPct, setReturnPct] = useState(7);
  const [inflationPct, setInflationPct] = useState(2);

  const r = useMemo(
    () => computeCompound({ initial, monthlyContribution: monthly, years, annualReturnPct: returnPct, annualInflationPct: inflationPct }),
    [initial, monthly, years, returnPct, inflationPct],
  );

  return (
    <Card>
      <CardTitle>Compound interest</CardTitle>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Slider label="Starting amount" value={initial} min={0} max={100000} step={500} onChange={setInitial} format={money} />
          <Slider label="Monthly contribution" value={monthly} min={0} max={3000} step={25} onChange={setMonthly} format={(v) => `${money(v)}/mo`} />
          <Slider label="Years" value={years} min={1} max={40} step={1} onChange={setYears} format={(v) => `${v} yr`} />
          <Slider label="Expected return" value={returnPct} min={0} max={15} step={0.5} onChange={setReturnPct} format={(v) => `${v}%/yr`} />
          <Slider label="Inflation" value={inflationPct} min={0} max={6} step={0.5} onChange={setInflationPct} format={(v) => `${v}%/yr`} />
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-dim">Future value</p>
            <p className="tabular text-3xl font-semibold">{money(r.futureValue)}</p>
            <p className="text-xs text-text-dim">
              {money(r.realFutureValue)} in today&rsquo;s dollars
            </p>
          </div>
          <div className="tabular flex gap-6 text-sm">
            <div>
              <p className="text-xs text-text-dim">You put in</p>
              <p className="font-medium">{money(r.totalContributions)}</p>
            </div>
            <div>
              <p className="text-xs text-text-dim">Growth earned</p>
              <p className="font-medium text-good">{money(r.interestEarned)}</p>
            </div>
          </div>
          <GrowthChart series={r.series} />
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

function GrowthChart({ series }: { series: { year: number; contributions: number; value: number }[] }) {
  const max = Math.max(...series.map((p) => p.value), 1);
  const w = 280;
  const h = 80;
  const x = (i: number) => (i / Math.max(series.length - 1, 1)) * w;
  const y = (v: number) => h - (v / max) * (h - 4) - 2;
  const valueArea = `0,${h} ` + series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ") + ` ${w},${h}`;
  const contribArea = `0,${h} ` + series.map((p, i) => `${x(i).toFixed(1)},${y(p.contributions).toFixed(1)}`).join(" ") + ` ${w},${h}`;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none" aria-hidden>
        <polygon points={valueArea} fill="var(--accent)" opacity="0.35" />
        <polygon points={contribArea} fill="var(--text-dim)" opacity="0.3" />
      </svg>
      <p className="mt-1 text-xs text-text-dim">Grey = your contributions · orange = growth on top</p>
    </div>
  );
}
