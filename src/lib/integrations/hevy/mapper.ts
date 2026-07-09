import { HevyWorkout } from "./client";

export interface MappedSet {
  exercise: string;
  set_no: number;
  reps: number | null;
  weight_kg: number | null;
  set_type: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
  notes: string | null;
}

export interface MappedWorkout {
  title: string;
  notes: string | null;
  performed_on: string; // YYYY-MM-DD, UTC date of start_time
  kind: "strength" | "cardio" | "other";
  duration_min: number | null;
  distance_km: number | null;
  provider_workout_id: string;
  raw: HevyWorkout;
  sets: MappedSet[];
}

/**
 * Hevy Workout → Caffeinatd's internal model. Pure function (no I/O) so the
 * inference rules (kind, duration, distance) are unit-testable without a
 * live API call. The full source payload rides along in `raw` for analytics
 * fields we don't have typed columns for yet (superset ids, custom metrics).
 */
export function mapHevyWorkout(w: HevyWorkout): MappedWorkout {
  const sets: MappedSet[] = w.exercises.flatMap((ex) =>
    ex.sets.map((s) => ({
      exercise: ex.title,
      set_no: s.index + 1,
      reps: s.reps,
      weight_kg: s.weight_kg,
      set_type: s.type,
      distance_meters: s.distance_meters,
      duration_seconds: s.duration_seconds,
      rpe: s.rpe,
      notes: ex.notes,
    })),
  );

  const kind = inferKind(sets);
  const durationMin = durationMinutes(w.start_time, w.end_time);
  const distanceKm = totalDistanceKm(sets);

  return {
    title: w.title || "Workout",
    notes: w.description || null,
    performed_on: w.start_time.slice(0, 10),
    kind,
    duration_min: durationMin,
    distance_km: distanceKm,
    provider_workout_id: w.id,
    raw: w,
    sets,
  };
}

function inferKind(sets: MappedSet[]): "strength" | "cardio" | "other" {
  const hasWeight = sets.some((s) => s.weight_kg !== null && s.weight_kg > 0);
  if (hasWeight) return "strength";
  const hasCardioSignal = sets.some((s) => s.distance_meters !== null || s.duration_seconds !== null);
  if (hasCardioSignal) return "cardio";
  return "other";
}

function durationMinutes(startISO: string, endISO: string): number | null {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.round((end - start) / 60_000);
}

function totalDistanceKm(sets: MappedSet[]): number | null {
  const meters = sets.reduce((sum, s) => sum + (s.distance_meters ?? 0), 0);
  return meters > 0 ? Math.round((meters / 1000) * 100) / 100 : null;
}
