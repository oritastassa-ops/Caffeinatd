export interface ConsistencyResult {
  consistencyPercent: number; // sessions actually done vs. target, trailing 12 weeks
  currentStreakWeeks: number; // consecutive weeks (including this one) with >=1 workout
  longestStreakWeeks: number;
  avgPerWeek: number;
}

const TRAILING_WEEKS = 12;

function weekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** Deterministic — from workout dates alone, no AI. */
export function computeConsistency(
  performedDates: string[],
  weeklyTarget: number,
  now = new Date(),
): ConsistencyResult {
  const weeksWithWorkout = new Set(performedDates.map(weekStart));

  const currentWeekStart = weekStart(now.toISOString().slice(0, 10));
  let streak = 0;
  const cursor = new Date(`${currentWeekStart}T00:00:00Z`);
  while (weeksWithWorkout.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  // Longest streak over every week that ever had a workout, plus gaps between them.
  const sortedWeeks = [...weeksWithWorkout].sort();
  let longest = 0;
  let running = 0;
  let prevWeek: Date | null = null;
  for (const w of sortedWeeks) {
    const d = new Date(`${w}T00:00:00Z`);
    if (prevWeek && (d.getTime() - prevWeek.getTime()) / (7 * 86_400_000) === 1) {
      running++;
    } else {
      running = 1;
    }
    longest = Math.max(longest, running);
    prevWeek = d;
  }

  const trailingCutoff = new Date(now.getTime() - TRAILING_WEEKS * 7 * 86_400_000).toISOString().slice(0, 10);
  const trailingSessions = performedDates.filter((d) => d >= trailingCutoff).length;
  const avgPerWeek = Math.round((trailingSessions / TRAILING_WEEKS) * 10) / 10;
  const target = Math.max(weeklyTarget, 1) * TRAILING_WEEKS;
  const consistencyPercent = Math.min(100, Math.round((trailingSessions / target) * 100));

  return { consistencyPercent, currentStreakWeeks: streak, longestStreakWeeks: longest, avgPerWeek };
}
