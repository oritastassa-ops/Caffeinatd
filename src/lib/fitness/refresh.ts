import { SupabaseClient } from "@supabase/supabase-js";
import { computeExerciseMetrics, SetRow } from "./metrics";

interface JoinedSetRow {
  exercise: string;
  reps: number | null;
  weight_kg: number | null;
  workouts: { performed_on: string } | { performed_on: string }[] | null;
}

/** Flat set rows across every workout for a user, regardless of source (manual or Hevy). */
export async function fetchSetRows(supabase: SupabaseClient, userId: string): Promise<SetRow[]> {
  const { data } = await supabase
    .from("workout_sets")
    .select("exercise, reps, weight_kg, workouts!inner(performed_on)")
    .eq("user_id", userId);

  return ((data ?? []) as unknown as JoinedSetRow[])
    .map((r) => {
      const w = Array.isArray(r.workouts) ? r.workouts[0] : r.workouts;
      if (!w) return null;
      return { exercise: r.exercise, performed_on: w.performed_on, reps: r.reps, weight_kg: r.weight_kg };
    })
    .filter((r): r is SetRow => r !== null);
}

/** Recomputes the fitness_metrics cache from scratch. Called after sync and after manual logging. */
export async function recomputeFitnessMetrics(supabase: SupabaseClient, userId: string): Promise<void> {
  const rows = await fetchSetRows(supabase, userId);
  const metrics = computeExerciseMetrics(rows);
  if (metrics.length === 0) return;

  await supabase.from("fitness_metrics").upsert(
    metrics.map((m) => ({
      user_id: userId,
      exercise: m.exercise,
      estimated_1rm: m.estimated1RM,
      max_weight_kg: m.maxWeightKg,
      max_reps: m.maxReps,
      total_volume: m.totalVolume,
      volume_7d: m.volume7d,
      volume_30d: m.volume30d,
      frequency_30d: m.frequency30d,
      last_performed_on: m.lastPerformedOn,
      updated_at: new Date().toISOString(),
    })),
  );
}
