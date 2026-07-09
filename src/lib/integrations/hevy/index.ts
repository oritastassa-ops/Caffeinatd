import { SupabaseClient } from "@supabase/supabase-js";
import { TestConnectionResult } from "@/lib/integrations/types";
import { getMostRecentWorkout, getUserInfo } from "./client";
import { toSafeMessage } from "./errors";
import { syncHevyWorkouts } from "./sync";

/** The only Hevy function anything outside this folder calls directly. */
export async function testHevyConnection(apiKey: string): Promise<TestConnectionResult> {
  try {
    const [user, latest] = await Promise.all([getUserInfo(apiKey), getMostRecentWorkout(apiKey)]);
    return {
      ok: true,
      username: user.name,
      providerUserId: user.id,
      lastWorkoutAt: latest?.start_time ?? null,
    };
  } catch (err) {
    return { ok: false, error: toSafeMessage(err) };
  }
}

const DEFAULT_SYNC_INTERVAL_MINUTES = 30;

/**
 * "Invisible" sync — call this from anywhere that's about to show or reason
 * over workout data (Fitness page, daily plan, insights) instead of a manual
 * button. No-ops instantly if there's no connection or the last sync is
 * still fresh, so it's cheap to call on every relevant page load.
 */
export async function syncIfStale(
  supabase: SupabaseClient,
  userId: string,
  intervalMinutes = DEFAULT_SYNC_INTERVAL_MINUTES,
): Promise<void> {
  const { data: integration } = await supabase
    .from("fitness_integrations")
    .select("last_synced_at")
    .eq("user_id", userId)
    .eq("provider", "hevy")
    .maybeSingle();

  if (!integration) return; // not connected — nothing to sync

  const staleForMs = integration.last_synced_at
    ? Date.now() - new Date(integration.last_synced_at).getTime()
    : Infinity;
  if (staleForMs < intervalMinutes * 60_000) return; // fresh enough

  await syncHevyWorkouts(supabase, userId).catch(() => null); // never let a sync hiccup break the caller's page
}

export { syncHevyWorkouts };
