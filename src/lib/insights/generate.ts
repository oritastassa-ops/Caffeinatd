import { SupabaseClient } from "@supabase/supabase-js";
import { CalendarEvent, InsightDomain, Profile } from "@/lib/types";
import { endOfDayISO, formatTime, localDateStr, startOfDayISO } from "@/lib/utils";
import { getAccessToken } from "@/lib/google/oauth";
import { listEvents } from "@/lib/google/calendar";
import { syncIfStale } from "@/lib/integrations/hevy";
import { fetchSetRows } from "@/lib/fitness/refresh";
import { SetRow, computeProgressionTrend } from "@/lib/fitness/metrics";
import { computeMuscleRecovery } from "@/lib/fitness/recovery";
import { recommendNextWorkout } from "@/lib/fitness/recommend";
import { findFreeSlot } from "@/lib/fitness/scheduling";
import { getProgram, recommendProgramSession } from "@/lib/fitness/programs";
import { fetchFinanceData } from "@/lib/finance/data";
import { financeInsightCandidates } from "./finance";
import { fetchHomeData } from "@/lib/home/data";
import { homeInsightCandidates } from "./home";

export interface InsightCandidate {
  domain: InsightDomain;
  message: string;
  reason: string;
  importance: number;
  dedupKey: string;
  expiresAt?: string;
  /** When present, the UI shows a "Do it" action that opens the command bar pre-filled with this text. */
  actionPreset?: string;
}

/**
 * Deterministic, rule-based — not an LLM call. Each rule is a plain
 * threshold against real data, so "why am I seeing this" always has a
 * concrete answer, and generation costs nothing against the AI provider's
 * quota. Safe to run on every Today-page load, not just from a cron job.
 */

function fitnessInsights(
  workouts: { performed_on: string }[],
  weeklyTarget: number,
  today: string,
): InsightCandidate[] {
  // Pure UTC math on the (already timezone-resolved) date string — mixing in
  // machine-local getDay() made "past midweek" depend on the server's clock.
  const todayUtc = new Date(`${today}T00:00:00Z`);
  const weekStart = new Date(todayUtc);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay()); // Sunday
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const thisWeekCount = workouts.filter((w) => w.performed_on >= weekStartStr).length;
  const dayOfWeek = todayUtc.getUTCDay(); // 0 Sun .. 6 Sat

  if (weeklyTarget >= 2 && thisWeekCount === 0 && dayOfWeek >= 3) {
    return [
      {
        domain: "fitness",
        message: `You usually train ${weeklyTarget}x/week but haven't logged a workout this week.`,
        reason: `Your weekly workout target is ${weeklyTarget} and it's already past midweek.`,
        importance: 4,
        dedupKey: `fitness:missed_week:${weekStartStr}`,
        expiresAt: endOfWeekISO(weekStart),
      },
    ];
  }
  return [];
}

function nutritionInsights(
  todayProteinG: number,
  proteinGoal: number | undefined,
  hourOfDay: number,
  today: string,
): InsightCandidate[] {
  if (!proteinGoal) return [];
  const expectedPace = proteinGoal * Math.min(hourOfDay / 20, 1); // goal reached by ~8pm
  const gap = expectedPace - todayProteinG;
  if (gap >= 25) {
    return [
      {
        domain: "nutrition",
        message: `You're ${Math.round(gap)}g behind pace on protein today.`,
        reason: `${todayProteinG}g logged vs. an expected ~${Math.round(expectedPace)}g by this hour toward your ${proteinGoal}g goal.`,
        importance: 2,
        dedupKey: `nutrition:protein_pace:${today}`,
        expiresAt: endOfDayUTC(today),
      },
    ];
  }
  return [];
}

function calendarInsights(events: CalendarEvent[], tz: string, today: string): InsightCandidate[] {
  const out: InsightCandidate[] = [];

  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i]!;
    const b = timed[i + 1]!;
    if (new Date(a.end).getTime() > new Date(b.start).getTime()) {
      out.push({
        domain: "calendar",
        message: `"${a.summary}" and "${b.summary}" overlap today.`,
        reason: "Two events on your calendar occupy the same time slot.",
        importance: 5,
        dedupKey: `calendar:overlap:${today}:${a.id}:${b.id}`,
        expiresAt: endOfDayUTC(today),
      });
    }
  }

  const first = timed[0];
  if (first) {
    const startHour = Number(
      new Date(first.start).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit" }),
    );
    if (startHour <= 8) {
      out.push({
        domain: "calendar",
        message: `Early start today — "${first.summary}" at ${formatTime(first.start, tz)}. Budget ~45 minutes to get ready.`,
        reason: "Your first event today starts at or before 8am.",
        importance: 2,
        dedupKey: `calendar:early_start:${today}:${first.id}`,
        expiresAt: endOfDayUTC(today),
      });
    }
  }
  return out;
}

function taskInsights(overdueCount: number, today: string): InsightCandidate[] {
  if (overdueCount >= 3) {
    return [
      {
        domain: "tasks",
        message: `You have ${overdueCount} overdue tasks. Want to reorganize them?`,
        reason: `${overdueCount} open tasks have a due date in the past.`,
        importance: 4,
        dedupKey: `tasks:overdue:${today}`,
        expiresAt: endOfDayUTC(today),
      },
    ];
  }
  return [];
}

/**
 * Only looks at today — a full week-ahead scan is real future scope, not
 * built here. Suggests, never books: the "action" is a command-bar preset
 * the user still has to submit, per "suggestion → confirmation."
 */
function fitnessScheduleInsight(
  setRows: SetRow[],
  todayEvents: CalendarEvent[],
  today: string,
  programSession: string | undefined,
): InsightCandidate[] {
  if (setRows.length === 0) return [];
  const recovery = computeMuscleRecovery(setRows);
  const recommendation = recommendNextWorkout(recovery);
  if (recommendation.label === "Rest day") return [];

  const slot = findFreeSlot(todayEvents, 60);
  if (!slot) return [];

  // With a training split we suggest the SESSION ("Upper B"); otherwise the
  // recovery-based muscle group.
  const label = programSession && !programSession.startsWith("Rest") ? programSession : recommendation.label;
  const isSession = Boolean(programSession && !programSession.startsWith("Rest"));

  return [
    {
      domain: "fitness",
      message: `You have a free block today (${slot.start}–${slot.end}). Want to ${isSession ? `do ${label}` : `train ${label.toLowerCase()}`}?`,
      reason: isSession ? `${label} is next in your training split.` : recommendation.reason,
      importance: 2,
      dedupKey: `fitness:schedule:${today}:${label}`,
      expiresAt: endOfDayUTC(today),
      actionPreset: `schedule my ${label}${isSession ? " session" : " workout"} today from ${slot.start} to ${slot.end}`,
    },
  ];
}

/** Flags an exercise with no progress over the last month among frequently-trained ones. */
function plateauInsight(setRows: SetRow[], today: string): InsightCandidate[] {
  const exercises = [...new Set(setRows.map((r) => r.exercise))];
  const trends = exercises
    .map((exercise) => computeProgressionTrend(setRows, exercise))
    .filter((t) => t.current1RM !== null && t.previous1RM !== null && t.changePercent !== null);

  const plateaued = trends.filter((t) => t.changePercent! <= 0).sort((a, b) => a.changePercent! - b.changePercent!);
  const worst = plateaued[0];
  if (!worst) return [];

  return [
    {
      domain: "fitness",
      message: `Your ${worst.exercise} hasn't progressed in the last month. A lighter deload week might help.`,
      reason: `Estimated 1RM went from ${Math.round(worst.previous1RM!)}kg to ${Math.round(worst.current1RM!)}kg (${worst.changePercent}%) over the last 30 days.`,
      importance: 2,
      dedupKey: `fitness:plateau:${worst.exercise}:${today.slice(0, 7)}`, // one per exercise per month
      expiresAt: endOfWeekISO(new Date(today)),
    },
  ];
}

function endOfDayUTC(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59Z`).toISOString();
}

function endOfWeekISO(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  return end.toISOString();
}

export interface InsightGenInput {
  workouts: { performed_on: string; title?: string }[];
  setRows: SetRow[];
  todayProteinG: number;
  todayEvents: CalendarEvent[];
  overdueTaskCount: number;
  /** Program-aware next-session label (e.g. "Upper B"), when a split is set. */
  programSession?: string;
}

export function computeInsightCandidates(profile: Profile, input: InsightGenInput): InsightCandidate[] {
  const tz = profile.timezone;
  const today = localDateStr(tz);
  const hourOfDay = Number(new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit" }));

  return [
    ...fitnessInsights(input.workouts, profile.settings.weeklyWorkoutTarget ?? 3, today),
    ...nutritionInsights(input.todayProteinG, profile.settings.proteinGoal, hourOfDay, today),
    ...calendarInsights(input.todayEvents, tz, today),
    ...taskInsights(input.overdueTaskCount, today),
    ...fitnessScheduleInsight(input.setRows, input.todayEvents, today, input.programSession),
    ...plateauInsight(input.setRows, today),
  ];
}

/** An insight row as freshly inserted — the caller notifies on these. */
export interface CreatedInsight {
  id: string;
  domain: InsightDomain;
  message: string;
  importance: number;
  dedup_key: string;
}

/**
 * Runs the rule set against real data and upserts new/still-relevant insights.
 * Cheap — DB reads only. Returns ONLY the rows actually inserted this run (the
 * `ignoreDuplicates` upsert with `.select()` returns just the non-conflicting
 * inserts), so the caller can notify on genuinely new insights and not re-notify
 * on regeneration.
 */
export async function ensureInsights(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<CreatedInsight[]> {
  const tz = profile.timezone;
  const today = localDateStr(tz);
  const weekAgo = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);

  // Fitness insights should reason over fresh data, not whatever was synced
  // last time someone happened to open the Fitness page.
  await syncIfStale(supabase, profile.id);

  const [{ data: workouts }, { data: todayMeals }, { count: overdueCount }] = await Promise.all([
    supabase
      .from("workouts")
      .select("performed_on, title")
      .gte("performed_on", weekAgo)
      .order("performed_on", { ascending: false }),
    supabase
      .from("meals")
      .select("protein_g")
      .gte("eaten_at", `${today}T00:00:00`)
      .lte("eaten_at", `${today}T23:59:59`),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .is("completed_at", null)
      .lt("due_at", new Date().toISOString()),
  ]);

  // Calendar events are optional — a user without Calendar connected just
  // gets fewer candidate insights, not an error.
  let todayEvents: CalendarEvent[] = [];
  try {
    const token = await getAccessToken(supabase, profile.id);
    if (token) {
      todayEvents = await listEvents(token, startOfDayISO(today, tz), endOfDayISO(today, tz), profile.id);
    }
  } catch {
    // calendar hiccup shouldn't block other insights
  }

  const todayProteinG = (todayMeals ?? []).reduce((sum, m) => sum + (m.protein_g ?? 0), 0);
  const setRows = await fetchSetRows(supabase, profile.id);

  // Program-aware next session, so the scheduling suggestion names a session.
  const program = getProgram(profile.settings.trainingProgramId);
  const programRec = program
    ? recommendProgramSession(program, workouts ?? [], computeMuscleRecovery(setRows), today)
    : null;

  const candidates = computeInsightCandidates(profile, {
    workouts: workouts ?? [],
    setRows,
    todayProteinG,
    todayEvents,
    overdueTaskCount: overdueCount ?? 0,
    programSession: programRec?.nextSession,
  });

  // Finance rules run over the same fetch the finance pages use.
  try {
    const financeData = await fetchFinanceData(supabase, profile.id);
    candidates.push(...financeInsightCandidates(financeData));
  } catch {
    // finance hiccup shouldn't block other insights
  }

  // Home rules — no household is a normal state, not an error.
  try {
    const homeData = await fetchHomeData(supabase, profile.id);
    if (homeData) candidates.push(...homeInsightCandidates(homeData, today));
  } catch {
    // home hiccup shouldn't block other insights
  }

  if (candidates.length === 0) return [];

  const { data, error } = await supabase
    .from("insights")
    .upsert(
      candidates.map((c) => ({
        user_id: profile.id,
        domain: c.domain,
        message: c.message,
        reason: c.reason,
        importance: c.importance,
        dedup_key: c.dedupKey,
        expires_at: c.expiresAt ?? null,
        action_preset: c.actionPreset ?? null,
      })),
      { onConflict: "user_id,dedup_key", ignoreDuplicates: true },
    )
    .select("id, domain, message, importance, dedup_key");
  if (error) throw new Error(`Failed to save insights: ${error.message}`);
  return (data ?? []) as CreatedInsight[];
}
