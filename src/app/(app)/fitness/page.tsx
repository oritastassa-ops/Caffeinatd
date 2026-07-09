import Link from "next/link";
import { after } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Workout, WorkoutSet } from "@/lib/types";
import { Card, CardTitle, EmptyState } from "@/components/ui";
import { PixelAvatar } from "@/components/avatars/pixel-avatar";
import { HevyConnectButton } from "@/components/hevy-connect-modal";
import { IntegrationControls } from "@/components/integration-controls";
import { MuscleRecoveryBars } from "@/components/muscle-recovery-bars";
import { FitnessGoals } from "@/components/fitness-goals";
import { relativeTime } from "@/lib/utils";
import { syncIfStale } from "@/lib/integrations/hevy";
import { fetchSetRows } from "@/lib/fitness/refresh";
import { computeMuscleRecovery } from "@/lib/fitness/recovery";
import { computeConsistency } from "@/lib/fitness/consistency";
import { computeProgressionTrend } from "@/lib/fitness/metrics";
import { getProgram, recommendProgramSession } from "@/lib/fitness/programs";
import { formatVolume, formatWeight, weightValue } from "@/lib/fitness/units";
import { localDateStr } from "@/lib/utils";
import { dismissFitnessOnboarding } from "./actions";

export const dynamic = "force-dynamic";

export default async function FitnessPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);

  // Trigger 1 of the "invisible sync" set: opening this page syncs if stale.
  // Deferred past the response so navigation never waits on the Hevy API —
  // the sync lands in the background and the next visit shows it.
  after(() => syncIfStale(supabase, user.id).catch(() => null));

  const [{ data }, { data: integration }, { data: metricsRows }, setRows] = await Promise.all([
    supabase.from("workouts").select("*, workout_sets(*)").order("performed_on", { ascending: false }).limit(20),
    supabase
      .from("fitness_integrations")
      .select("status, provider_username, last_synced_at, last_success_at, last_failed_at, last_sync_error, last_sync_duration_ms, total_imported")
      .eq("provider", "hevy")
      .maybeSingle(),
    supabase.from("fitness_metrics").select("*").order("updated_at", { ascending: false }).limit(8),
    fetchSetRows(supabase, user.id),
  ]);

  const workouts = (data ?? []).map((w) => ({
    ...w,
    sets: (w.workout_sets ?? []) as WorkoutSet[],
  })) as (Workout & { sets: WorkoutSet[] })[];

  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const thisWeek = workouts.filter((w) => w.performed_on >= weekAgo);
  const weekVolume = thisWeek
    .flatMap((w) => w.sets)
    .reduce((sum, s) => sum + (s.reps ?? 0) * (s.weight_kg ?? 0), 0);

  const unit = profile.settings.weightUnit ?? "kg";
  const recovery = computeMuscleRecovery(setRows);
  const program = getProgram(profile.settings.trainingProgramId);
  const recommendation = recommendProgramSession(
    program,
    workouts.map((w) => ({ performed_on: w.performed_on, title: w.title })),
    recovery,
    localDateStr(profile.timezone),
  );
  const consistency = computeConsistency(
    [...new Set(setRows.map((r) => r.performed_on))],
    profile.settings.weeklyWorkoutTarget ?? 3,
  );

  const progressHighlights = (metricsRows ?? [])
    .map((m) => ({ ...m, trend: computeProgressionTrend(setRows, m.exercise) }))
    .filter((m) => m.trend.changePercent !== null)
    .slice(0, 4);

  const goals = (profile.settings.fitnessGoals ?? []).map((g) => {
    const m = metricsRows?.find((x) => x.exercise === g.exercise);
    return { ...g, currentWeightKg: m?.max_weight_kg ?? 0 };
  });

  const isConnected = integration?.status === "connected";
  const showOnboarding = !integration && !profile.settings.fitnessOnboardingDismissed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Fitness Intelligence</h1>
        {isConnected && (
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
            Synced from Hevy
          </span>
        )}
      </div>

      {showOnboarding && (
        <Card className="border-accent/30 bg-accent-soft/40">
          <p className="text-base font-medium">Connect your fitness tracker</p>
          <p className="mt-1 text-sm text-text-dim">
            Import workouts automatically from your favorite fitness app. Caffeinatd will analyze
            your training, recovery, consistency, and progress without requiring duplicate logging.
          </p>
          <div className="mt-4 flex gap-2">
            <HevyConnectButton label="Connect Hevy" />
            <form action={dismissFitnessOnboarding}>
              <button className="rounded-xl border px-4 py-2.5 text-sm text-text-dim hover:text-text">
                Continue without integration
              </button>
            </form>
          </div>
        </Card>
      )}

      {/* Current program + recommended next session */}
      <Card className="card-enter border-accent/30 bg-accent-soft/40">
        <div className="flex items-start gap-3">
          <PixelAvatar personality="coaching" size={40} mode="idle" className="mt-1" />
          <div className="min-w-0">
            {program && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-dim">
                {program.name}
              </p>
            )}
            <CardTitle>Recommended next {program ? "session" : "workout"}</CardTitle>
            <p className="text-lg font-semibold">{recommendation.label}</p>
            <p className="mt-0.5 text-sm text-text-dim">{recommendation.reason}</p>
          </div>
        </div>
      </Card>

      {/* Recovery status */}
      <Card>
        <CardTitle>Muscle recovery</CardTitle>
        <MuscleRecoveryBars recoveries={recovery} />
      </Card>

      {/* Current goals */}
      <Card>
        <CardTitle>Goals</CardTitle>
        <FitnessGoals goals={goals} unit={unit} />
      </Card>

      {/* Progress highlights */}
      {progressHighlights.length > 0 && (
        <Card>
          <CardTitle>Progress highlights</CardTitle>
          <ul className="flex flex-col gap-2.5">
            {progressHighlights.map((m) => (
              <li key={m.exercise} className="flex items-center justify-between text-sm">
                <span>{m.exercise}</span>
                <span className="tabular flex items-center gap-2">
                  <span>{m.estimated_1rm ? `${formatWeight(m.estimated_1rm, unit)} est. 1RM` : "—"}</span>
                  <span
                    className={
                      m.trend.changePercent! > 0 ? "text-good" : m.trend.changePercent! < 0 ? "text-bad" : "text-text-dim"
                    }
                  >
                    {m.trend.changePercent! > 0 ? "+" : ""}
                    {m.trend.changePercent}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Training analytics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardTitle>This week</CardTitle>
          <p className="tabular text-2xl font-semibold">{thisWeek.length}</p>
          <p className="text-xs text-text-dim">workouts</p>
        </Card>
        <Card>
          <CardTitle>Volume (7d)</CardTitle>
          <p className="tabular text-2xl font-semibold">{formatVolume(weekVolume, unit).split(" ")[0]}</p>
          <p className="text-xs text-text-dim">{unit} lifted</p>
        </Card>
        <Card>
          <CardTitle>Consistency</CardTitle>
          <p className="tabular text-2xl font-semibold">{consistency.consistencyPercent}%</p>
          <p className="text-xs text-text-dim">{consistency.avgPerWeek}/week avg</p>
        </Card>
        <Card>
          <CardTitle>Streak</CardTitle>
          <p className="tabular text-2xl font-semibold">{consistency.currentStreakWeeks}w</p>
          <p className="text-xs text-text-dim">longest {consistency.longestStreakWeeks}w</p>
        </Card>
      </div>

      {/* Recent workouts */}
      <Card>
        <CardTitle>Recent workouts</CardTitle>
        {workouts.length === 0 ? (
          <EmptyState
            character="coaching"
            title="Maggie's warming up while she waits"
            hint="Connect Hevy above, or tell Caffeinatd about your session — “logged bench 3x8 at 60kg and squats 3x5 at 80.”"
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {workouts.map((w) => (
              <li key={w.id} className="border-b pb-4 last:border-b-0 last:pb-0">
                <Link href={`/fitness/${w.id}`} className="block hover:opacity-80">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium">
                      {w.title}
                      {w.source === "hevy" && (
                        <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-dim">
                          Hevy
                        </span>
                      )}
                    </p>
                    <span className="tabular text-xs text-text-dim">{w.performed_on}</span>
                  </div>
                  <p className="mt-0.5 text-xs capitalize text-text-dim">
                    {w.kind}
                    {w.duration_min ? ` · ${w.duration_min} min` : ""}
                    {w.distance_km ? ` · ${w.distance_km} km` : ""}
                  </p>
                </Link>
                {w.sets.length > 0 && (
                  <div className="tabular mt-2 flex flex-wrap gap-1.5">
                    {w.sets.map((s) => (
                      <span key={s.id} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">
                        {s.exercise} {s.reps ?? "–"}×{weightValue(s.weight_kg, unit)}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sync status */}
      {integration && (
        <Card>
          <CardTitle>Sync status</CardTitle>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5 text-sm">
              <p>
                Hevy —{" "}
                {integration.status === "connected" ? (
                  <span className="text-good">✓ Connected</span>
                ) : (
                  <span className="text-bad">Error</span>
                )}
              </p>
              <p className="text-xs text-text-dim">{integration.total_imported ?? 0} workouts imported</p>
              {integration.last_success_at && (
                <p className="text-xs text-text-dim">Last sync: {relativeTime(integration.last_success_at)}</p>
              )}
              {integration.last_failed_at && integration.status !== "connected" && (
                <p className="text-xs text-bad">
                  Last failed sync: {relativeTime(integration.last_failed_at)} — {integration.last_sync_error}
                </p>
              )}
              {integration.last_sync_duration_ms !== null && (
                <p className="text-xs text-text-dim">Took {(integration.last_sync_duration_ms / 1000).toFixed(1)}s</p>
              )}
            </div>
            <IntegrationControls provider="hevy" />
          </div>
        </Card>
      )}
    </div>
  );
}
