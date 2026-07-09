import { MuscleRecovery } from "./recovery";

export interface WorkoutRecommendation {
  label: string; // e.g. "Legs" or "Rest day"
  reason: string;
}

/**
 * Deterministic pick: the most-recovered group that's also gone the longest
 * without training. If nothing is at least "Recovering", recommend rest
 * rather than pushing a fatigued muscle group.
 */
export function recommendNextWorkout(recoveries: MuscleRecovery[]): WorkoutRecommendation {
  const candidates = recoveries.filter((r) => r.percent >= 50); // Recovering or Ready
  if (candidates.length === 0) {
    return {
      label: "Rest day",
      reason: "Everything trained recently is still recovering — a rest day fits best right now.",
    };
  }
  const sorted = [...candidates].sort((a, b) => {
    const aDate = a.lastTrainedOn ?? "0000-00-00";
    const bDate = b.lastTrainedOn ?? "0000-00-00";
    return aDate < bDate ? -1 : aDate > bDate ? 1 : b.percent - a.percent;
  });
  const pick = sorted[0]!;
  return {
    label: capitalize(pick.group),
    reason:
      pick.lastTrainedOn === null
        ? `${capitalize(pick.group)} hasn't been trained yet.`
        : `${capitalize(pick.group)} is ${pick.label.toLowerCase()} (${pick.percent}%) and was last trained ${pick.lastTrainedOn}.`,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
