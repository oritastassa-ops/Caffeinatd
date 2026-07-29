import { SupabaseClient } from "@supabase/supabase-js";
import { CalendarEvent, DailyPlan, Profile } from "@/lib/types";
import { getAccessToken } from "@/lib/google/oauth";
import { listEvents } from "@/lib/google/calendar";
import { computeReadiness } from "@/lib/planning/readiness";
import { getProgram } from "@/lib/fitness/programs";
import { endOfDayISO, formatTime, localDateStr, startOfDayISO } from "@/lib/utils";

/**
 * The "situation brief": a compact snapshot of the user's day, injected into the
 * assistant's system prompt on every turn so the most common questions — what's
 * my day, am I free at 3, what should I do now — answer in ONE hop instead of
 * spending a get_agenda/list_tasks round trip the model may or may not choose to
 * make. `generateDailyPlan` already proved this shape (daily.ts:66): gather
 * everything in one parallel round trip, then reason once.
 *
 * Design rules this module holds itself to:
 *  - Budget. Target ~600–900 tokens for the whole brief. We truncate LISTS
 *    (tasks, events, priorities), never fields — a half-sentence is worse than a
 *    shorter list. Asserted in tests/pipeline-context.test.ts.
 *  - Graceful degradation. No calendar, no plan, no tasks → the section is
 *    OMITTED, not rendered as "none" noise. A missing section never errors.
 *  - Freshness without a second cache. The calendar read reuses the existing 10s
 *    agenda cache (listEvents, keyed by user id), so the get_agenda tool later in
 *    the same turn doesn't re-fetch. No new cache was needed — measured against
 *    the existing one.
 */

/** Injectable calendar fetch so the brief is testable without a network. */
export type CalendarFetcher = (
  supabase: SupabaseClient,
  profile: Profile,
  today: string,
) => Promise<{ today: CalendarEvent[]; tomorrow: CalendarEvent[]; connected: boolean }>;

const defaultCalendarFetcher: CalendarFetcher = async (supabase, profile, today) => {
  const token = await getAccessToken(supabase, profile.id);
  if (!token) return { today: [], tomorrow: [], connected: false };
  const tz = profile.timezone;
  const dayStart = startOfDayISO(today, tz);
  const tomorrowDate = localDateStr(tz, new Date(new Date(dayStart).getTime() + 36 * 3600_000));
  // cacheKey = user id → shares the 10s agendaCache with the get_agenda tool.
  const [todayEvents, tomorrowEvents] = await Promise.all([
    listEvents(token, dayStart, endOfDayISO(today, tz), profile.id),
    listEvents(token, startOfDayISO(tomorrowDate, tz), endOfDayISO(tomorrowDate, tz), profile.id),
  ]);
  return { today: todayEvents, tomorrow: tomorrowEvents, connected: true };
};

export interface BriefOptions {
  now?: Date;
  fetchCalendar?: CalendarFetcher;
}

const MAX_TASKS = 8;
const MAX_EVENTS = 8;
const MAX_PRIORITIES = 5;

/**
 * Assemble the brief. Returns "" when there is genuinely nothing to say (a
 * brand-new account) so the caller can omit the block entirely.
 */
export async function buildSituationBrief(
  supabase: SupabaseClient,
  profile: Profile,
  opts: BriefOptions = {},
): Promise<string> {
  const tz = profile.timezone;
  const now = opts.now ?? new Date();
  const today = localDateStr(tz, now);
  const fetchCalendar = opts.fetchCalendar ?? defaultCalendarFetcher;

  // One parallel round trip — the daily.ts pattern. Every read is cheap and
  // independently catchable, so one slow/missing source never sinks the brief.
  const [calendar, planRow, tasksRes, mealsRes, workoutsRes] = await Promise.all([
    fetchCalendar(supabase, profile, today).catch(() => ({ today: [], tomorrow: [], connected: false })),
    supabase.from("daily_plans").select("plan").eq("plan_date", today).maybeSingle(),
    supabase
      .from("tasks")
      .select("title, priority, due_at")
      .is("completed_at", null)
      .order("priority")
      .order("due_at", { nullsFirst: false })
      .limit(15),
    supabase.from("meals").select("protein_g").gte("eaten_at", startOfDayISO(today, tz)),
    supabase
      .from("workouts")
      .select("id")
      .gte("performed_on", weekStartDate(now, tz)),
  ]);

  const tasks = (tasksRes.data ?? []) as { title: string; priority: number; due_at: string | null }[];
  const meals = (mealsRes.data ?? []) as { protein_g: number | null }[];
  const plan = (planRow.data?.plan ?? null) as DailyPlan | null;

  const nowParts = localParts(now, tz);
  const overdueCount = tasks.filter((t) => t.due_at !== null && t.due_at < now.toISOString()).length;

  const readiness = computeReadiness({
    overdueTaskCount: overdueCount,
    weeklyWorkoutTarget: profile.settings.weeklyWorkoutTarget ?? 0,
    workoutsThisWeek: (workoutsRes.data ?? []).length,
    dayOfWeek: nowParts.dayOfWeek,
    proteinGoal: profile.settings.proteinGoal,
    proteinLoggedToday: meals.reduce((s, m) => s + (m.protein_g ?? 0), 0),
    mealsLoggedToday: meals.length,
    hourOfDay: nowParts.hour,
    todayEvents: calendar.today,
  });

  const sections: string[] = [];

  // Header line always carries the date + readiness (readiness is always
  // computable, even for an empty account — it just reads 100).
  sections.push(
    `Today: ${nowParts.weekday} ${today} (${tz}). Readiness ${readiness.score}/100 — ${readiness.reasons.join("; ")}.`,
  );

  if (plan) {
    const planBits = [
      plan.overview ? truncate(plan.overview, 240) : "",
      plan.priorities?.length
        ? `Priorities: ${plan.priorities.slice(0, MAX_PRIORITIES).join("; ")}.`
        : "",
      plan.freeWindows?.length ? `Free windows: ${plan.freeWindows.join(", ")}.` : "",
    ].filter(Boolean);
    if (planBits.length) sections.push(`Today's plan: ${planBits.join(" ")}`);
  }

  if (calendar.today.length) {
    sections.push(`Calendar today: ${formatEvents(calendar.today, tz)}`);
  }
  if (calendar.tomorrow.length) {
    sections.push(`Calendar tomorrow: ${formatEvents(calendar.tomorrow, tz)}`);
  }

  if (tasks.length) {
    const shown = tasks.slice(0, MAX_TASKS).map((t) => {
      const due = t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : "";
      return `[P${t.priority}] ${t.title}${due}`;
    });
    const more = tasks.length > MAX_TASKS ? ` (+${tasks.length - MAX_TASKS} more)` : "";
    sections.push(`Open tasks: ${shown.join("; ")}${more}.`);
  }

  const goals = formatGoals(profile);
  if (goals) sections.push(goals);

  // Only the header exists for a truly empty account → nothing worth injecting.
  return sections.length > 1 ? sections.join("\n") : "";
}

function formatEvents(events: CalendarEvent[], tz: string): string {
  const shown = events
    .slice(0, MAX_EVENTS)
    .map((e) =>
      e.allDay
        ? `${e.summary} (all day)`
        : `${formatTime(e.start, tz)}–${formatTime(e.end, tz)} ${e.summary}`,
    );
  const more = events.length > MAX_EVENTS ? ` (+${events.length - MAX_EVENTS} more)` : "";
  return `${shown.join("; ")}${more}.`;
}

function formatGoals(profile: Profile): string {
  const s = profile.settings;
  const bits: string[] = [];
  if (s.calorieGoal || s.proteinGoal) {
    const macro = [s.calorieGoal ? `${s.calorieGoal} kcal` : "", s.proteinGoal ? `${s.proteinGoal}g protein` : ""]
      .filter(Boolean)
      .join(", ");
    bits.push(macro);
  }
  if (s.sleepHours) bits.push(`sleep ${s.sleepHours}h`);
  const program = getProgram(s.trainingProgramId);
  if (program) bits.push(`split: ${program.name}`);
  return bits.length ? `Goals: ${bits.join("; ")}.` : "";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Local weekday name, hour (0-23), and day-of-week (0=Sun) in one pass. */
function localParts(now: Date, tz: string): { weekday: string; hour: number; dayOfWeek: number } {
  const weekday = now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
  const hour = Number(now.toLocaleString("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).slice(0, 2));
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return { weekday, hour: Number.isFinite(hour) ? hour % 24 : 0, dayOfWeek: Math.max(0, dayNames.indexOf(weekday)) };
}

/** The local-week Monday as YYYY-MM-DD, for "workouts this week". */
function weekStartDate(now: Date, tz: string): string {
  const parts = localParts(now, tz);
  const daysSinceMonday = (parts.dayOfWeek + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(now.getTime() - daysSinceMonday * 86400_000);
  return localDateStr(tz, monday);
}
