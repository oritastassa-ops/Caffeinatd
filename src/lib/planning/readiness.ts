import { CalendarEvent } from "@/lib/types";
import { findConflicts } from "@/lib/google/calendar";

export interface ReadinessInput {
  overdueTaskCount: number;
  weeklyWorkoutTarget: number;
  workoutsThisWeek: number;
  dayOfWeek: number; // 0 Sun .. 6 Sat, local
  proteinGoal: number | undefined;
  proteinLoggedToday: number;
  mealsLoggedToday: number;
  hourOfDay: number; // local, 0-23
  todayEvents: CalendarEvent[];
}

export interface ReadinessResult {
  score: number; // 0-100
  reasons: string[]; // every deduction, in plain language — nothing hidden
}

/**
 * Deterministic 0-100 "how on-track is today" score. Every deduction is
 * named so the UI can show exactly why the number is what it is — this is
 * explicitly not meant to be a black box.
 */
export function computeReadiness(input: ReadinessInput): ReadinessResult {
  let score = 100;
  const reasons: string[] = [];

  if (input.overdueTaskCount > 0) {
    const penalty = Math.min(input.overdueTaskCount * 10, 40);
    score -= penalty;
    reasons.push(`-${penalty}: ${input.overdueTaskCount} overdue task${input.overdueTaskCount > 1 ? "s" : ""}`);
  }

  if (input.weeklyWorkoutTarget >= 2 && input.workoutsThisWeek === 0 && input.dayOfWeek >= 3) {
    score -= 15;
    reasons.push(`-15: no workouts logged this week yet (target ${input.weeklyWorkoutTarget}/week)`);
  }

  if (input.proteinGoal && input.hourOfDay >= 14 && input.mealsLoggedToday === 0) {
    score -= 10;
    reasons.push("-10: nothing logged for nutrition yet today");
  }

  const timed = input.todayEvents.filter((e) => !e.allDay);
  let hasConflict = false;
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]!;
    const rest = timed.slice(i + 1).map((e) => ({ start: e.start, end: e.end }));
    if (findConflicts(rest, a.start, a.end).length > 0) hasConflict = true;
  }
  if (hasConflict) {
    score -= 20;
    reasons.push("-20: two calendar events overlap today");
  }

  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) reasons.push("Nothing pulling your day off track right now.");
  return { score, reasons };
}

export interface RecoveryStatus {
  label: string;
  detail: string;
}

/** Deterministic heuristic from hours since the last logged/synced workout — no AI call. */
export function computeRecoveryStatus(lastWorkoutISO: string | null, now = Date.now()): RecoveryStatus {
  if (!lastWorkoutISO) {
    return { label: "No data yet", detail: "Log or sync a workout to see recovery status." };
  }
  const hoursSince = (now - new Date(lastWorkoutISO).getTime()) / 3_600_000;
  if (hoursSince < 20) {
    return { label: "Recovering", detail: "Trained within the last day — a light day or rest is reasonable." };
  }
  if (hoursSince < 72) {
    return { label: "Ready", detail: "Recovered from your last session." };
  }
  const days = Math.floor(hoursSince / 24);
  return { label: "Well rested", detail: `${days} days since your last workout.` };
}
