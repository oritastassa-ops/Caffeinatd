import { FinanceAccount, FinanceGoal, FinanceTransaction, FinanceSnapshot } from "@/lib/types";
import type { InsightCandidate } from "./generate"; // type-only: keeps the generate↔finance cycle inert at runtime
import { computeMonthCashflow, computeMonthlyAverages, computeUpcoming } from "@/lib/finance/cashflow";
import { computeNetWorth } from "@/lib/finance/networth";
import { forecastGoal } from "@/lib/finance/forecast";
import { money } from "@/lib/finance/format";

export interface FinanceInsightInput {
  accounts: FinanceAccount[];
  transactions: FinanceTransaction[];
  goals: FinanceGoal[];
  snapshots: FinanceSnapshot[];
}

/** Deterministic finance rules — same contract as every other insight domain:
 *  thresholds over real rows, a named reason, a stable dedup key. */
export function financeInsightCandidates(input: FinanceInsightInput, today = new Date()): InsightCandidate[] {
  const out: InsightCandidate[] = [];
  const thisMonthKey = today.toISOString().slice(0, 7);
  const lastMonthKey = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);

  // ── Category spend swing ≥15% vs. last month (biggest mover only) ────────
  const thisMonth = computeMonthCashflow(input.transactions, thisMonthKey);
  const lastMonth = computeMonthCashflow(input.transactions, lastMonthKey);
  const dayOfMonth = today.getUTCDate();
  if (dayOfMonth >= 20 && lastMonth.expenses > 0) {
    // Only compare late in the month — a 15% "drop" on the 3rd is meaningless.
    let biggest: { category: string; pct: number; now: number; prev: number } | null = null;
    for (const cat of lastMonth.byCategory) {
      if (cat.amount < 100) continue; // ignore noise categories
      const now = thisMonth.byCategory.find((c) => c.category === cat.category)?.amount ?? 0;
      const pct = Math.round(((now - cat.amount) / cat.amount) * 100);
      if (Math.abs(pct) >= 15 && (!biggest || Math.abs(pct) > Math.abs(biggest.pct))) {
        biggest = { category: cat.category, pct, now, prev: cat.amount };
      }
    }
    if (biggest) {
      const direction = biggest.pct < 0 ? "less" : "more";
      out.push({
        domain: "finance",
        message: `You've spent ${Math.abs(biggest.pct)}% ${direction} on ${biggest.category} this month.`,
        reason: `${money(biggest.now)} so far vs. ${money(biggest.prev)} last month.`,
        importance: biggest.pct < 0 ? 2 : 3,
        dedupKey: `finance:category_swing:${thisMonthKey}:${biggest.category}`,
        expiresAt: endOfMonthISO(today),
      });
    }
  }

  // ── Emergency fund milestone ──────────────────────────────────────────────
  const { avgExpenses } = computeMonthlyAverages(input.transactions, 3, today);
  if (avgExpenses > 0) {
    const nw = computeNetWorth(input.accounts, input.snapshots, today);
    const months = Math.floor(nw.cashAvailable / avgExpenses);
    if (months >= 3) {
      out.push({
        domain: "finance",
        message: `You have about ${months} months of expenses in liquid savings.`,
        reason: `${money(nw.cashAvailable)} liquid vs. ~${money(avgExpenses)}/month average expenses.`,
        importance: 1,
        dedupKey: `finance:emergency_months:${months}`, // re-fires only when the number changes
      });
    }
  }

  // ── Goal behind its deadline ──────────────────────────────────────────────
  for (const goal of input.goals) {
    const linked = input.accounts.find((a) => a.id === goal.linked_account_id) ?? null;
    const f = forecastGoal(goal, linked, today);
    if (f.onTrackForDeadline === false) {
      out.push({
        domain: "finance",
        message: `"${goal.title}" is behind schedule at the current pace.`,
        reason:
          f.estimatedCompletion === null
            ? `No monthly contribution is set, so there's no path to the ${goal.deadline} deadline.`
            : `Estimated completion ${f.estimatedCompletion}, deadline ${goal.deadline}.`,
        importance: 4,
        dedupKey: `finance:goal_behind:${goal.id}:${thisMonthKey}`,
        expiresAt: endOfMonthISO(today),
        actionPreset: `what if I increase my monthly contribution to "${goal.title}"?`,
      });
    }
  }

  // ── Large upcoming bill vs. available cash ────────────────────────────────
  const upcoming = computeUpcoming(input.transactions, 14, today);
  const nw = computeNetWorth(input.accounts, input.snapshots, today);
  const bigBill = upcoming.find((u) => u.direction === "expense" && u.amount > nw.cashAvailable);
  if (bigBill && nw.cashAvailable > 0) {
    out.push({
      domain: "finance",
      message: `"${bigBill.description}" (${money(bigBill.amount)}) due ${bigBill.dueOn} exceeds your available cash.`,
      reason: `Cash available is ${money(nw.cashAvailable)}.`,
      importance: 5,
      dedupKey: `finance:cash_shortfall:${bigBill.dueOn}:${bigBill.description}`,
      expiresAt: new Date(`${bigBill.dueOn}T23:59:59Z`).toISOString(),
    });
  }

  return out;
}

function endOfMonthISO(today: Date): string {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
}
