import { estimate1RM, SetRow } from "./metrics";

export type PRType = "weight" | "estimated_1rm" | "volume";

export interface PersonalRecord {
  exercise: string;
  type: PRType;
  value: number;
  previousValue: number | null;
}

/**
 * Compares one workout's sets against everything logged before it (for the
 * same user) to find new bests. Computed fresh every time — not read from a
 * stored table — so improving this logic never leaves stale PRs on record.
 * Works identically whether the workout came from Hevy or manual logging.
 */
export function detectPRs(workoutSets: SetRow[], priorSets: SetRow[]): PersonalRecord[] {
  const exercises = [...new Set(workoutSets.map((s) => s.exercise))];
  const prs: PersonalRecord[] = [];

  for (const exercise of exercises) {
    const thisWorkout = workoutSets.filter((s) => s.exercise === exercise && s.weight_kg && s.reps);
    if (thisWorkout.length === 0) continue;
    const prior = priorSets.filter((s) => s.exercise === exercise && s.weight_kg && s.reps);

    const priorMaxWeight = prior.length ? Math.max(...prior.map((s) => s.weight_kg!)) : null;
    const thisMaxWeight = Math.max(...thisWorkout.map((s) => s.weight_kg!));
    if (priorMaxWeight === null || thisMaxWeight > priorMaxWeight) {
      prs.push({ exercise, type: "weight", value: thisMaxWeight, previousValue: priorMaxWeight });
    }

    const priorBest1RM = prior.length ? Math.max(...prior.map((s) => estimate1RM(s.weight_kg!, s.reps!))) : null;
    const thisBest1RM = Math.max(...thisWorkout.map((s) => estimate1RM(s.weight_kg!, s.reps!)));
    if (priorBest1RM === null || thisBest1RM > priorBest1RM) {
      prs.push({
        exercise,
        type: "estimated_1rm",
        value: Math.round(thisBest1RM * 10) / 10,
        previousValue: priorBest1RM !== null ? Math.round(priorBest1RM * 10) / 10 : null,
      });
    }

    const thisVolume = thisWorkout.reduce((sum, s) => sum + s.reps! * s.weight_kg!, 0);
    const priorSessionVolumes = new Map<string, number>();
    for (const s of prior) {
      priorSessionVolumes.set(s.performed_on, (priorSessionVolumes.get(s.performed_on) ?? 0) + s.reps! * s.weight_kg!);
    }
    const priorMaxVolume = priorSessionVolumes.size ? Math.max(...priorSessionVolumes.values()) : null;
    if (priorMaxVolume === null || thisVolume > priorMaxVolume) {
      prs.push({
        exercise,
        type: "volume",
        value: Math.round(thisVolume * 10) / 10,
        previousValue: priorMaxVolume !== null ? Math.round(priorMaxVolume * 10) / 10 : null,
      });
    }
  }

  return prs;
}
