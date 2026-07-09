import { inferMuscleGroup, MuscleGroup } from "./muscle-groups";
import { SetRow } from "./metrics";

export interface MuscleRecovery {
  group: MuscleGroup;
  percent: number; // 0-100, 100 = fully recovered
  label: "Fatigued" | "Recovering" | "Ready";
  detail: string; // always explains the number — never a black box
  lastTrainedOn: string | null;
}

const MIN_RECOVERY_HOURS = 24;
const MAX_RECOVERY_HOURS = 72;

/**
 * Deterministic — no AI. Recovery time needed scales with how much volume
 * was done relative to that muscle group's own rolling average: a heavy
 * session demands more recovery than a light one, which is a decent proxy
 * without needing actual physiological data (HRV, soreness, etc.).
 */
export function computeMuscleRecovery(rows: SetRow[], now = new Date()): MuscleRecovery[] {
  const byGroup = new Map<MuscleGroup, Map<string, number>>(); // group -> date -> volume that day
  for (const r of rows) {
    const group = inferMuscleGroup(r.exercise);
    if (group === "other") continue;
    if (!byGroup.has(group)) byGroup.set(group, new Map());
    const dayMap = byGroup.get(group)!;
    const vol = (r.reps ?? 0) * (r.weight_kg ?? 0);
    dayMap.set(r.performed_on, (dayMap.get(r.performed_on) ?? 0) + vol);
  }

  const results: MuscleRecovery[] = [];
  for (const [group, dayMap] of byGroup) {
    const sessions = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)); // newest first
    const [lastDate, lastVolume] = sessions[0]!;
    const avgVolume = sessions.reduce((sum, [, v]) => sum + v, 0) / sessions.length;
    const volumeRatio = avgVolume > 0 ? lastVolume / avgVolume : 1;

    const recoveryHoursNeeded = Math.min(
      MAX_RECOVERY_HOURS,
      Math.max(MIN_RECOVERY_HOURS, MIN_RECOVERY_HOURS + Math.min(volumeRatio, 2) * 24),
    );
    const hoursSince = (now.getTime() - new Date(`${lastDate}T12:00:00Z`).getTime()) / 3_600_000;
    const percent = Math.max(0, Math.min(100, Math.round((hoursSince / recoveryHoursNeeded) * 100)));

    const label = percent < 50 ? "Fatigued" : percent < 90 ? "Recovering" : "Ready";
    const hoursRounded = Math.round(hoursSince);
    const detail = `${percent}% because you trained ${group} ${hoursRounded}h ago; that session's volume suggests ~${Math.round(recoveryHoursNeeded)}h to recover.`;

    results.push({ group, percent, label, detail, lastTrainedOn: lastDate });
  }

  return results.sort((a, b) => a.percent - b.percent); // most fatigued first
}
