import { FinanceAccount, FinanceTransaction, LIQUID_KINDS } from "@/lib/types";
import { round2, sum } from "./networth";
import { computeMonthlyAverages } from "./cashflow";
import { GoalForecast } from "./forecast";

export interface HealthFactor {
  name: string;
  earned: number;
  max: number;
  reason: string; // plain language — the score is never arbitrary
}

export interface FinancialHealth {
  score: number; // 0-100
  factors: HealthFactor[];
  emergencyFundMonths: number | null;
}

/**
 * Deterministic 0-100 score, same explainability contract as the readiness
 * score: every point earned or missed is named. Weights: emergency fund 25,
 * savings rate 25, debt ratio 20, goal pace 15, contribution consistency 15.
 */
export function computeFinancialHealth(
  accounts: FinanceAccount[],
  transactions: FinanceTransaction[],
  goalForecasts: GoalForecast[],
  today = new Date(),
): FinancialHealth {
  const factors: HealthFactor[] = [];
  const active = accounts.filter((a) => !a.archived_at);
  const { avgIncome, avgExpenses, monthsWithData } = computeMonthlyAverages(transactions, 3, today);

  // ── Emergency fund (25) ──────────────────────────────────────────────────
  const liquid = sum(active.filter((a) => a.side === "asset" && LIQUID_KINDS.includes(a.kind)).map((a) => a.balance));
  let emergencyFundMonths: number | null = null;
  if (avgExpenses > 0) {
    emergencyFundMonths = round2(liquid / avgExpenses);
    const earned = Math.min(25, Math.round((emergencyFundMonths / 6) * 25)); // 6 months = full marks
    factors.push({
      name: "Emergency fund",
      earned,
      max: 25,
      reason: `${emergencyFundMonths.toFixed(1)} months of expenses in liquid accounts (6+ months earns full marks).`,
    });
  } else {
    factors.push({
      name: "Emergency fund",
      earned: 12,
      max: 25,
      reason: "Not enough expense history to measure — log expenses for a month to score this properly.",
    });
  }

  // ── Savings rate (25) ────────────────────────────────────────────────────
  if (avgIncome > 0) {
    const rate = ((avgIncome - avgExpenses) / avgIncome) * 100;
    const earned = Math.max(0, Math.min(25, Math.round((rate / 20) * 25))); // 20% rate = full marks
    factors.push({
      name: "Savings rate",
      earned,
      max: 25,
      reason: `Averaging ${Math.round(rate)}% of income saved over the last ${monthsWithData || 1} month(s) (20%+ earns full marks).`,
    });
  } else {
    factors.push({
      name: "Savings rate",
      earned: 12,
      max: 25,
      reason: "No income logged yet — log income to score this properly.",
    });
  }

  // ── Debt ratio (20) ──────────────────────────────────────────────────────
  const assets = sum(active.filter((a) => a.side === "asset").map((a) => a.balance));
  const liabilities = sum(active.filter((a) => a.side === "liability").map((a) => a.balance));
  if (assets > 0) {
    const ratio = liabilities / assets;
    const earned = Math.max(0, Math.min(20, Math.round((1 - ratio) * 20)));
    factors.push({
      name: "Debt ratio",
      earned,
      max: 20,
      reason:
        liabilities === 0
          ? "No debt."
          : `Debt is ${Math.round(ratio * 100)}% of assets (lower is better; 0% earns full marks).`,
    });
  } else {
    factors.push({
      name: "Debt ratio",
      earned: liabilities > 0 ? 0 : 10,
      max: 20,
      reason: liabilities > 0 ? "Debt with no recorded assets." : "No accounts yet — add them to score this.",
    });
  }

  // ── Goal pace (15) ───────────────────────────────────────────────────────
  const withDeadline = goalForecasts.filter((g) => g.onTrackForDeadline !== null);
  if (goalForecasts.length === 0) {
    factors.push({
      name: "Goal progress",
      earned: 7,
      max: 15,
      reason: "No goals set — a concrete goal makes progress measurable.",
    });
  } else if (withDeadline.length === 0) {
    const avgProgress = sum(goalForecasts.map((g) => g.progressPercent)) / goalForecasts.length;
    factors.push({
      name: "Goal progress",
      earned: Math.round((avgProgress / 100) * 15),
      max: 15,
      reason: `Goals are ${Math.round(avgProgress)}% funded on average (no deadlines set to measure pace against).`,
    });
  } else {
    const onTrack = withDeadline.filter((g) => g.onTrackForDeadline).length;
    factors.push({
      name: "Goal progress",
      earned: Math.round((onTrack / withDeadline.length) * 15),
      max: 15,
      reason: `${onTrack} of ${withDeadline.length} deadline goal(s) on track at the current contribution pace.`,
    });
  }

  // ── Contribution consistency (15) ────────────────────────────────────────
  const monthKeys: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const contributionMonths = monthKeys.filter((m) =>
    transactions.some(
      (t) =>
        t.direction === "expense" &&
        (t.category === "savings" || t.category === "investments") &&
        t.occurred_on.startsWith(m),
    ),
  ).length;
  factors.push({
    name: "Contribution consistency",
    earned: Math.round((contributionMonths / 3) * 15),
    max: 15,
    reason: `Savings/investment contributions logged in ${contributionMonths} of the last 3 months.`,
  });

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.earned, 0)));
  return { score, factors, emergencyFundMonths };
}
