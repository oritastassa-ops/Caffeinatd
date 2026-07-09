/**
 * Deterministic strength metrics — no AI involved. Works identically for
 * Hevy-synced and manually logged sets since both land in the same
 * workouts/workout_sets shape; this module only sees flat rows.
 */

export interface SetRow {
  exercise: string;
  performed_on: string; // YYYY-MM-DD
  reps: number | null;
  weight_kg: number | null;
}

export interface ExerciseMetric {
  exercise: string;
  estimated1RM: number | null;
  maxWeightKg: number | null;
  maxReps: number | null;
  totalVolume: number;
  volume7d: number;
  volume30d: number;
  frequency30d: number; // distinct sessions touching this exercise, last 30 days
  lastPerformedOn: string | null;
}

/** Epley formula — standard, simple, good enough for trend tracking (not a medical device). */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

function volume(rows: SetRow[]): number {
  return rows.reduce((sum, r) => sum + (r.reps ?? 0) * (r.weight_kg ?? 0), 0);
}

function daysAgo(dateStr: string, days: number, now: Date): boolean {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return dateStr >= cutoff;
}

/** Groups flat set rows by exercise and computes every metric for each. */
export function computeExerciseMetrics(rows: SetRow[], now = new Date()): ExerciseMetric[] {
  const byExercise = new Map<string, SetRow[]>();
  for (const r of rows) {
    if (!byExercise.has(r.exercise)) byExercise.set(r.exercise, []);
    byExercise.get(r.exercise)!.push(r);
  }

  return [...byExercise.entries()].map(([exercise, exRows]) => {
    const weighted = exRows.filter((r) => r.weight_kg !== null && r.reps !== null && r.weight_kg > 0);
    const estimated1RM = weighted.length
      ? Math.round(Math.max(...weighted.map((r) => estimate1RM(r.weight_kg!, r.reps!))) * 10) / 10
      : null;
    const maxWeightKg = weighted.length ? Math.max(...weighted.map((r) => r.weight_kg!)) : null;
    const maxReps = exRows.some((r) => r.reps !== null)
      ? Math.max(...exRows.filter((r) => r.reps !== null).map((r) => r.reps!))
      : null;

    const last7d = exRows.filter((r) => daysAgo(r.performed_on, 7, now));
    const last30d = exRows.filter((r) => daysAgo(r.performed_on, 30, now));
    const sessions30d = new Set(last30d.map((r) => r.performed_on)).size;
    const lastPerformedOn = exRows.reduce<string | null>(
      (max, r) => (max === null || r.performed_on > max ? r.performed_on : max),
      null,
    );

    return {
      exercise,
      estimated1RM,
      maxWeightKg,
      maxReps,
      totalVolume: Math.round(volume(exRows) * 10) / 10,
      volume7d: Math.round(volume(last7d) * 10) / 10,
      volume30d: Math.round(volume(last30d) * 10) / 10,
      frequency30d: sessions30d,
      lastPerformedOn,
    };
  });
}

export interface ProgressionTrend {
  exercise: string;
  current1RM: number | null; // best in the last 30 days
  previous1RM: number | null; // best in the 30 days before that
  changePercent: number | null;
}

/** Compares this month's best estimated 1RM against the prior month's, for one exercise. */
export function computeProgressionTrend(rows: SetRow[], exercise: string, now = new Date()): ProgressionTrend {
  const weighted = rows.filter(
    (r) => r.exercise === exercise && r.weight_kg !== null && r.reps !== null && r.weight_kg > 0,
  );
  const current = weighted.filter((r) => daysAgo(r.performed_on, 30, now));
  const previous = weighted.filter((r) => daysAgo(r.performed_on, 60, now) && !daysAgo(r.performed_on, 30, now));

  const best = (set: SetRow[]) =>
    set.length ? Math.max(...set.map((r) => estimate1RM(r.weight_kg!, r.reps!))) : null;

  const current1RM = best(current);
  const previous1RM = best(previous);
  const changePercent =
    current1RM !== null && previous1RM !== null && previous1RM > 0
      ? Math.round(((current1RM - previous1RM) / previous1RM) * 1000) / 10
      : null;

  return { exercise, current1RM, previous1RM, changePercent };
}
