import { SupabaseClient } from "@supabase/supabase-js";
import { Profile } from "@/lib/types";
import { localDateStr } from "@/lib/utils";
import { fetchSetRows } from "./refresh";
import { computeExerciseMetrics, computeProgressionTrend } from "./metrics";
import { computeMuscleRecovery } from "./recovery";
import { computeConsistency } from "./consistency";
import { getProgram, recommendProgramSession } from "./programs";
import { formatWeight } from "./units";

/**
 * Compact text digest handed to the model as a tool result — every number
 * in it comes from the deterministic modules, never from the LLM. This is
 * what lets "how's my bench" and "what should I train today" get real,
 * numbers-backed, program-aware answers. Weights are rendered in the user's
 * chosen unit (storage stays kg).
 */
export async function buildFitnessReport(
  supabase: SupabaseClient,
  profile: Profile,
  exerciseFilter?: string,
): Promise<string> {
  const rows = await fetchSetRows(supabase, profile.id);
  if (rows.length === 0) return "No workouts logged yet.";
  const unit = profile.settings.weightUnit ?? "kg";

  const lines: string[] = [];

  // ── Program + next session (so the model recommends a SESSION, not a muscle) ──
  const program = getProgram(profile.settings.trainingProgramId);
  const recovery = computeMuscleRecovery(rows);
  const { data: recentWorkouts } = await supabase
    .from("workouts")
    .select("performed_on, title")
    .order("performed_on", { ascending: false })
    .limit(10);
  const rec = recommendProgramSession(program, recentWorkouts ?? [], recovery, localDateStr(profile.timezone));
  if (program) {
    lines.push(`Current program: ${program.name}. Recommended next session: ${rec.label}. Reason: ${rec.reason}`);
    lines.push(
      "IMPORTANT: recommend the next SESSION by name (e.g. its day label), not an individual muscle group.",
    );
  } else {
    lines.push(`No training split set. Recovery-based suggestion: ${rec.label} — ${rec.reason}`);
  }

  if (recovery.length > 0) {
    lines.push("Recovery: " + recovery.map((r) => `${r.group} ${r.percent}% (${r.label})`).join(", "));
  }

  const consistency = computeConsistency(
    [...new Set(rows.map((r) => r.performed_on))],
    profile.settings.weeklyWorkoutTarget ?? 3,
  );
  lines.push(
    `Consistency: ${consistency.consistencyPercent}% of target, ${consistency.avgPerWeek} sessions/week average, current streak ${consistency.currentStreakWeeks} week(s), longest streak ${consistency.longestStreakWeeks} week(s).`,
  );

  const exercises = exerciseFilter
    ? [exerciseFilter]
    : [...new Set(computeExerciseMetrics(rows).map((m) => m.exercise))].slice(0, 8);
  const trendLines = exercises
    .map((ex) => {
      const t = computeProgressionTrend(rows, ex);
      if (t.current1RM === null) return null;
      const change =
        t.changePercent === null ? "" : ` (${t.changePercent > 0 ? "+" : ""}${t.changePercent}% vs prior month)`;
      return `${ex}: est. 1RM ${formatWeight(t.current1RM, unit)}${change}`;
    })
    .filter((l): l is string => l !== null);
  if (trendLines.length > 0) lines.push("Progression: " + trendLines.join("; "));

  const goals = profile.settings.fitnessGoals ?? [];
  if (goals.length > 0) {
    const metrics = computeExerciseMetrics(rows);
    const goalLines = goals.map((g) => {
      const m = metrics.find((x) => x.exercise === g.exercise);
      const current = m?.maxWeightKg ?? 0;
      const progress = Math.min(100, Math.round((current / g.targetWeightKg) * 100));
      return `${g.exercise} goal: ${formatWeight(current, unit)} of ${formatWeight(g.targetWeightKg, unit)} target (${progress}%)`;
    });
    lines.push("Goals: " + goalLines.join("; "));
  }

  return lines.join("\n");
}
