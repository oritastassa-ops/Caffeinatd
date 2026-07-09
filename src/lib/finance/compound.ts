import { round2 } from "./networth";

export interface CompoundInput {
  initial: number;
  monthlyContribution: number;
  years: number;
  annualReturnPct: number;
  annualInflationPct?: number;
}

export interface CompoundPoint {
  year: number;
  contributions: number; // cumulative principal in
  value: number;         // nominal
  realValue: number;     // inflation-adjusted
}

export interface CompoundResult {
  futureValue: number;
  realFutureValue: number;
  totalContributions: number;
  interestEarned: number;
  series: CompoundPoint[]; // one point per year, for the chart
}

/** Standard monthly-compounding future value. Deterministic; the simulator UI and any AI
 *  explanation both read from this one function. */
export function computeCompound(input: CompoundInput): CompoundResult {
  const months = Math.max(0, Math.round(input.years * 12));
  const monthlyRate = input.annualReturnPct / 100 / 12;
  const monthlyInflation = (input.annualInflationPct ?? 0) / 100 / 12;

  let value = input.initial;
  let contributions = input.initial;
  const series: CompoundPoint[] = [
    { year: 0, contributions: round2(contributions), value: round2(value), realValue: round2(value) },
  ];

  for (let m = 1; m <= months; m++) {
    value = value * (1 + monthlyRate) + input.monthlyContribution;
    contributions += input.monthlyContribution;
    if (m % 12 === 0) {
      const deflator = Math.pow(1 + monthlyInflation, m);
      series.push({
        year: m / 12,
        contributions: round2(contributions),
        value: round2(value),
        realValue: round2(value / deflator),
      });
    }
  }

  const deflator = Math.pow(1 + monthlyInflation, months);
  return {
    futureValue: round2(value),
    realFutureValue: round2(value / deflator),
    totalContributions: round2(contributions),
    interestEarned: round2(value - contributions),
    series,
  };
}
