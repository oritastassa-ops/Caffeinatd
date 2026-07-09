import { FinanceAccount, FinanceGoal } from "@/lib/types";
import { round2 } from "./networth";

export interface GoalForecast {
  goalId: string;
  title: string;
  currentAmount: number; // linked account balance when linked, else goal.current_amount
  targetAmount: number;
  progressPercent: number;
  monthsToTarget: number | null; // null = no contribution and not growing → never at current pace
  estimatedCompletion: string | null; // YYYY-MM
  onTrackForDeadline: boolean | null; // null when no deadline set
}

/**
 * Months until a goal is funded, with optional compound growth when the goal
 * is linked to an account that has an expected return. Iterative monthly sim
 * (capped) rather than a closed form so growth + contributions compose simply.
 */
export function forecastGoal(
  goal: FinanceGoal,
  linkedAccount: FinanceAccount | null,
  today = new Date(),
): GoalForecast {
  const current = linkedAccount ? linkedAccount.balance : goal.current_amount;
  const monthlyRate = linkedAccount?.expected_return_pct
    ? linkedAccount.expected_return_pct / 100 / 12
    : 0;

  let monthsToTarget: number | null = null;
  if (current >= goal.target_amount) {
    monthsToTarget = 0;
  } else if (goal.monthly_contribution > 0 || (monthlyRate > 0 && current > 0)) {
    let value = current;
    for (let m = 1; m <= 600; m++) {
      value = value * (1 + monthlyRate) + goal.monthly_contribution;
      if (value >= goal.target_amount) {
        monthsToTarget = m;
        break;
      }
    }
  }

  let estimatedCompletion: string | null = null;
  if (monthsToTarget !== null) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthsToTarget, 1));
    estimatedCompletion = d.toISOString().slice(0, 7);
  }

  let onTrackForDeadline: boolean | null = null;
  if (goal.deadline) {
    onTrackForDeadline =
      estimatedCompletion !== null && estimatedCompletion <= goal.deadline.slice(0, 7);
  }

  return {
    goalId: goal.id,
    title: goal.title,
    currentAmount: round2(current),
    targetAmount: goal.target_amount,
    progressPercent: Math.min(100, Math.round((current / goal.target_amount) * 100)),
    monthsToTarget,
    estimatedCompletion,
    onTrackForDeadline,
  };
}

/** "+$200/mo reaches this goal N months sooner" — the sensitivity line from the brief. */
export function contributionSensitivity(
  goal: FinanceGoal,
  linkedAccount: FinanceAccount | null,
  extraMonthly: number,
  today = new Date(),
): number | null {
  const base = forecastGoal(goal, linkedAccount, today);
  const boosted = forecastGoal(
    { ...goal, monthly_contribution: goal.monthly_contribution + extraMonthly },
    linkedAccount,
    today,
  );
  if (base.monthsToTarget === null || boosted.monthsToTarget === null) return null;
  return base.monthsToTarget - boosted.monthsToTarget;
}
