import { SupabaseClient } from "@supabase/supabase-js";
import { SyncResult } from "@/lib/integrations/types";
import { decryptSecret } from "@/lib/integrations/crypto";
import { getAllWorkoutEventsSince } from "./client";
import { mapHevyWorkout } from "./mapper";
import { HevyApiError, toSafeMessage } from "./errors";
import { fetchSetRows, recomputeFitnessMetrics } from "@/lib/fitness/refresh";
import { detectPRs } from "@/lib/fitness/prs";
import { SetRow } from "@/lib/fitness/metrics";

const LOCK_STALE_MS = 2 * 60_000; // a lock older than this is treated as a crashed sync, not a running one

/**
 * Runs an incremental sync for one user's Hevy connection. Uses the stored
 * `last_synced_at` as the `since` cursor — Hevy's events endpoint defaults
 * to the epoch, so the very first call naturally backfills full history.
 * Dedup and update-in-place both key off `(user_id, source='hevy',
 * provider_workout_id)`, enforced by a unique index in the migration.
 *
 * A `syncing_since` column acts as a DB-level lock so two overlapping
 * triggers (page load + cron, say) can't run concurrently — safe across
 * serverless instances, unlike an in-memory flag.
 */
export async function syncHevyWorkouts(supabase: SupabaseClient, userId: string): Promise<SyncResult> {
  const startedAt = Date.now();
  const { data: integration } = await supabase
    .from("fitness_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "hevy")
    .maybeSingle();

  if (!integration) return { ok: false, imported: 0, updated: 0, deleted: 0, error: "Not connected." };

  if (integration.syncing_since && Date.now() - new Date(integration.syncing_since).getTime() < LOCK_STALE_MS) {
    return { ok: false, imported: 0, updated: 0, deleted: 0, error: "A sync is already in progress." };
  }

  await supabase
    .from("fitness_integrations")
    .update({ syncing_since: new Date().toISOString() })
    .eq("id", integration.id);

  const isFirstSync = !integration.last_synced_at;
  const since = integration.last_synced_at ?? "1970-01-01T00:00:00Z";

  let apiKey: string;
  try {
    apiKey = decryptSecret(integration.encrypted_api_key);
  } catch {
    await releaseLock(supabase, integration.id, "error", "Stored key could not be read.");
    return { ok: false, imported: 0, updated: 0, deleted: 0, error: "Stored key could not be read." };
  }

  let events;
  try {
    events = await getAllWorkoutEventsSince(apiKey, since);
  } catch (err) {
    const message = toSafeMessage(err);
    await releaseLock(supabase, integration.id, "error", message);
    await supabase.from("fitness_events").insert({
      user_id: userId,
      type: "sync_failed",
      metadata: { error: message },
    });
    return { ok: false, imported: 0, updated: 0, deleted: 0, error: message };
  }

  let imported = 0;
  let updated = 0;
  let deleted = 0;

  // Grows as we process events in this run, so a multi-workout sync sees
  // earlier-in-batch workouts as history for PR comparisons on later ones —
  // without needing a DB round-trip per event.
  const historicalSets: SetRow[] = isFirstSync ? [] : await fetchSetRows(supabase, userId);

  for (const event of events) {
    if (event.type === "deleted") {
      const { error, count } = await supabase
        .from("workouts")
        .delete({ count: "exact" })
        .eq("user_id", userId)
        .eq("source", "hevy")
        .eq("provider_workout_id", event.id);
      if (!error && count) deleted += count;
      continue;
    }

    const mapped = mapHevyWorkout(event.workout);
    const { data: existing } = await supabase
      .from("workouts")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "hevy")
      .eq("provider_workout_id", mapped.provider_workout_id)
      .maybeSingle();

    // Conflict target is the primary key (the upsert default) — the natural
    // key (user_id, source, provider_workout_id) was already resolved above
    // via the explicit lookup, so `id` is set on update and omitted on insert.
    const { data: workoutRow, error: upsertError } = await supabase
      .from("workouts")
      .upsert({
        id: existing?.id,
        user_id: userId,
        source: "hevy",
        provider_workout_id: mapped.provider_workout_id,
        title: mapped.title,
        notes: mapped.notes,
        performed_on: mapped.performed_on,
        kind: mapped.kind,
        duration_min: mapped.duration_min,
        distance_km: mapped.distance_km,
        raw: mapped.raw,
      })
      .select("id")
      .single();

    if (upsertError || !workoutRow) continue;

    // Sets are fully replaced on every update — simpler and always correct
    // vs. diffing individual sets against Hevy's current state.
    await supabase.from("workout_sets").delete().eq("workout_id", workoutRow.id);
    if (mapped.sets.length > 0) {
      await supabase.from("workout_sets").insert(
        mapped.sets.map((s) => ({
          workout_id: workoutRow.id,
          user_id: userId,
          exercise: s.exercise,
          set_no: s.set_no,
          reps: s.reps,
          weight_kg: s.weight_kg,
          set_type: s.set_type,
          distance_meters: s.distance_meters,
          duration_seconds: s.duration_seconds,
          rpe: s.rpe,
          notes: s.notes,
        })),
      );
    }

    // Notifications and PR detection only make sense for real incremental
    // syncs — flooding the activity feed with "PR!" for 100 historical
    // workouts on first connect would be noise, not signal.
    if (!isFirstSync) {
      const thisWorkoutSets: SetRow[] = mapped.sets.map((s) => ({
        exercise: s.exercise,
        performed_on: mapped.performed_on,
        reps: s.reps,
        weight_kg: s.weight_kg,
      }));
      const prior = historicalSets.filter((r) => r.performed_on < mapped.performed_on);
      const prs = detectPRs(thisWorkoutSets, prior);

      await supabase.from("fitness_events").insert({
        user_id: userId,
        type: existing ? "updated_workout" : "new_workout",
        workout_id: workoutRow.id,
        metadata: { title: mapped.title, source: "hevy", prCount: prs.length },
      });
      for (const pr of prs) {
        await supabase.from("fitness_events").insert({
          user_id: userId,
          type: "pr",
          workout_id: workoutRow.id,
          metadata: pr,
        });
      }
    }

    historicalSets.push(
      ...mapped.sets.map((s) => ({
        exercise: s.exercise,
        performed_on: mapped.performed_on,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })),
    );

    if (existing) updated++;
    else imported++;
  }

  await recomputeFitnessMetrics(supabase, userId);

  const { count: totalImported } = await supabase
    .from("workouts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source", "hevy");

  const now = new Date().toISOString();
  await supabase
    .from("fitness_integrations")
    .update({
      status: "connected",
      last_synced_at: now,
      last_success_at: now,
      last_sync_status: "ok",
      last_sync_error: null,
      last_sync_duration_ms: Date.now() - startedAt,
      total_imported: totalImported ?? 0,
      syncing_since: null,
      updated_at: now,
    })
    .eq("id", integration.id);

  return { ok: true, imported, updated, deleted };
}

async function releaseLock(
  supabase: SupabaseClient,
  integrationId: string,
  status: "error",
  message: string,
): Promise<void> {
  await supabase
    .from("fitness_integrations")
    .update({
      status,
      last_sync_status: status,
      last_sync_error: message,
      last_failed_at: new Date().toISOString(),
      syncing_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", integrationId);
}

export { HevyApiError };
