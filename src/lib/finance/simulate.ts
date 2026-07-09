import { FinanceAccount, FinanceGoal, FinanceTransaction } from "@/lib/types";
import { round2 } from "./networth";
import { computeMonthlyAverages } from "./cashflow";
import { forecastGoal, GoalForecast } from "./forecast";
import { computeFinancialHealth } from "./health";

/**
 * The What-If engine — one function, two callers (the simulator UI's sliders
 * and the assistant's `simulate_finances` tool), so both always agree.
 * All deterministic; the LLM only ever explains what this returns.
 */

export interface WhatIfDelta {
  extraMonthlySavings?: number;   // + saves more, − saves less
  incomeChange?: number;          // Δ monthly income
  expenseChange?: number;         // Δ monthly recurring expenses
  oneTimePurchase?: number;       // immediate hit to cash
  annualReturnPct?: number;       // override expected return on goal-linked accounts
}

export interface ProjectionPoint {
  month: string; // YYYY-MM
  cash: number;
}

export interface SimulationSide {
  monthlyNet: number;
  cashIn12Months: number;
  cashCurve: ProjectionPoint[];
  goals: GoalForecast[];
  healthScore: number;
}

export interface SimulationResult {
  before: SimulationSide;
  after: SimulationSide;
}

export interface SimulationInput {
  accounts: FinanceAccount[];
  transactions: FinanceTransaction[];
  goals: FinanceGoal[];
  cashAvailable: number;
}

export function simulate(input: SimulationInput, delta: WhatIfDelta, today = new Date()): SimulationResult {
  const before = project(input, {}, today);
  const after = project(input, delta, today);
  return { before, after };
}

function project(input: SimulationInput, delta: WhatIfDelta, today: Date): SimulationSide {
  const { avgIncome, avgExpenses } = computeMonthlyAverages(input.transactions, 3, today);
  const income = avgIncome + (delta.incomeChange ?? 0);
  const expenses = avgExpenses + (delta.expenseChange ?? 0) + (delta.extraMonthlySavings ?? 0);
  // Extra savings reduce free cash flow but land in goals/investments — modeled
  // as an expense on the cash curve and a contribution on the goal forecasts.
  const monthlyNet = round2(income - expenses);

  let cash = input.cashAvailable - (delta.oneTimePurchase ?? 0);
  const cashCurve: ProjectionPoint[] = [];
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  for (let m = 1; m <= 12; m++) {
    cash += monthlyNet;
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
    cashCurve.push({ month: d.toISOString().slice(0, 7), cash: round2(cash) });
  }

  const extra = delta.extraMonthlySavings ?? 0;
  const perGoal = input.goals.length > 0 ? extra / input.goals.length : 0;
  const goals = input.goals.map((g) => {
    const linked = input.accounts.find((a) => a.id === g.linked_account_id) ?? null;
    const adjustedLinked =
      linked && delta.annualReturnPct !== undefined
        ? { ...linked, expected_return_pct: delta.annualReturnPct }
        : linked;
    const adjustedGoal =
      delta.oneTimePurchase && !linked
        ? g // one-time purchases hit cash, not goal balances
        : g;
    return forecastGoal(
      { ...adjustedGoal, monthly_contribution: g.monthly_contribution + perGoal },
      adjustedLinked,
      today,
    );
  });

  // Health under the delta: adjust liquid cash for the one-time purchase and
  // synthesize the income/expense shift as a virtual transaction stream is
  // overkill — instead recompute with adjusted account balances only, which
  // captures the dominant effects (emergency fund + debt ratio).
  const adjustedAccounts = applyPurchaseToCash(input.accounts, delta.oneTimePurchase ?? 0);
  const health = computeFinancialHealth(adjustedAccounts, input.transactions, goals, today);

  return { monthlyNet, cashIn12Months: cashCurve[11]?.cash ?? round2(cash), cashCurve, goals, healthScore: health.score };
}

/** Deducts a one-time purchase from liquid accounts, largest-balance first. */
function applyPurchaseToCash(accounts: FinanceAccount[], purchase: number): FinanceAccount[] {
  if (purchase <= 0) return accounts;
  let remaining = purchase;
  return [...accounts]
    .sort((a, b) => b.balance - a.balance)
    .map((a) => {
      if (remaining <= 0 || a.side !== "asset" || !["cash", "checking", "savings"].includes(a.kind)) return a;
      const deduct = Math.min(a.balance, remaining);
      remaining -= deduct;
      return { ...a, balance: round2(a.balance - deduct) };
    });
}
