import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AIProvider } from "@/lib/ai/types";
import { CalendarEvent, DailyPlan, Profile } from "@/lib/types";
import { getAccessToken } from "@/lib/google/oauth";
import { createEvent, listEvents } from "@/lib/google/calendar";
import { endOfDayISO, formatTime, localDateStr, startOfDayISO, zonedTimeToUtc } from "@/lib/utils";
import { recommendSleep } from "./sleep";
import { syncIfStale } from "@/lib/integrations/hevy";
import { fetchSetRows } from "@/lib/fitness/refresh";
import { computeMuscleRecovery } from "@/lib/fitness/recovery";
import { getProgram, recommendProgramSession } from "@/lib/fitness/programs";
import { fetchHomeData, HomeData } from "@/lib/home/data";
import { isDueOn, nextAssignee } from "@/lib/home/schedule";
import { collectionStatuses } from "@/lib/home/collections";
import { Chore } from "@/lib/types";

const timeBlockSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  title: z.string().min(1),
});

const planSchema = z.object({
  overview: z.string(),
  priorities: z.array(z.string()).max(5),
  workout: z.string(),
  nutrition: z.string(),
  freeWindows: z.array(z.string()),
  home: z.string().default(""), // default keeps plans stored before the Home pillar parseable
  // Time-blocked schedule for the free windows — this is what gets
  // materialized onto Google Calendar. Default keeps older stored plans valid.
  schedule: z.array(timeBlockSchema).max(6).default([]),
});

export interface GeneratedPlan {
  plan: DailyPlan;
  /** Calendar events actually created (titles) — empty when calendar isn't connected. */
  createdEvents: string[];
  /** Tasks actually created (titles) — priorities that had no matching open task. */
  createdTasks: string[];
  calendarConnected: boolean;
}

/**
 * Generate, persist, and — when `materialize` is set — act on the plan:
 * time blocks become real Google Calendar events, and priorities without a
 * matching open task become tasks. A plan the user can't see anywhere isn't
 * a plan.
 */
export async function generateDailyPlan(
  supabase: SupabaseClient,
  provider: AIProvider,
  profile: Profile,
  date?: string,
  materialize = false,
): Promise<GeneratedPlan> {
  const tz = profile.timezone;
  const planDate = date ?? localDateStr(tz);

  // The workout suggestion in this plan should reflect what actually
  // happened recently, not a stale Hevy snapshot. (Must finish before the
  // workout/set queries below read from those tables.)
  await syncIfStale(supabase, profile.id);

  // ── Gather context — one parallel round trip, not a serial chain ────────
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [accessToken, { data: tasks }, { data: workouts }, { data: meals }, home, setRows] =
    await Promise.all([
      getAccessToken(supabase, profile.id),
      supabase
        .from("tasks")
        .select("title, priority, due_at, category")
        .is("completed_at", null)
        .order("priority")
        .limit(15),
      supabase
        .from("workouts")
        .select("performed_on, kind, title")
        .gte("performed_on", weekAgo.slice(0, 10))
        .order("performed_on", { ascending: false }),
      supabase.from("meals").select("eaten_at, calories, protein_g").gte("eaten_at", weekAgo),
      fetchHomeData(supabase, profile.id).catch(() => null),
      fetchSetRows(supabase, profile.id),
    ]);

  let events: CalendarEvent[] = [];
  let tomorrowFirst: { time: string; summary: string } | null = null;
  if (accessToken) {
    const dayStart = startOfDayISO(planDate, tz);
    const nextDate = localDateStr(tz, new Date(new Date(dayStart).getTime() + 36 * 3600_000));
    const [todayEvents, tomorrow] = await Promise.all([
      listEvents(accessToken, dayStart, endOfDayISO(planDate, tz), profile.id),
      listEvents(accessToken, startOfDayISO(nextDate, tz), endOfDayISO(nextDate, tz), profile.id),
    ]);
    events = todayEvents;
    const first = tomorrow.find((e) => !e.allDay);
    if (first) tomorrowFirst = { time: formatTime24(first.start, tz), summary: first.summary };
  }

  const sleep = recommendSleep(tomorrowFirst, profile.settings);

  // ── Household context (deterministic; merged into the same plan) ────────
  let homeContext = "Household: not set up.";
  if (home) {
    const due = home.chores.filter((c) => isDueOn(c, planDate, home.completions));
    const collections = collectionStatuses(home.collections, planDate);
    const openItems = home.items.filter((i) => !i.completed_at).length;
    homeContext = [
      `Household chores due today: ${
        due.length
          ? due.map((c) => `${c.title}${assigneeName(c, home) ? ` (${assigneeName(c, home)})` : ""}`).join("; ")
          : "none"
      }.`,
      collections.length ? `Collections: ${collections.map((s) => s.label).join(" ")}` : "",
      openItems > 0 ? `Shopping: ${openItems} open item(s) across lists.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  // Program-aware workout recommendation: the next SESSION in the split, not
  // a bare muscle group. Falls back to recovery-based when no split is set.
  const program = getProgram(profile.settings.trainingProgramId);
  const workoutRec = recommendProgramSession(
    program,
    (workouts ?? []).map((w) => ({ performed_on: w.performed_on, title: w.title })),
    computeMuscleRecovery(setRows),
    planDate,
  );

  // ── One LLM call composes the plan ──────────────────────────────────────
  const context = [
    `Date: ${planDate}. User: ${profile.display_name}. Timezone: ${tz}.`,
    program
      ? `Training split: ${program.name}. Recommended next session: ${workoutRec.label} — ${workoutRec.reason} (Recommend this SESSION by name, not a single muscle.)`
      : `Workout suggestion (no split set): ${workoutRec.label} — ${workoutRec.reason}`,
    `Calendar today: ${
      events.length
        ? events
            .map((e) => (e.allDay ? `${e.summary} (all day)` : `${formatTime(e.start, tz)}–${formatTime(e.end, tz)} ${e.summary}`))
            .join("; ")
        : accessToken
          ? "no events"
          : "calendar not connected"
    }`,
    `Open tasks (priority 1=urgent): ${
      tasks?.length ? tasks.map((t) => `[P${t.priority}] ${t.title}${t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : ""}`).join("; ") : "none"
    }`,
    `Workouts last 7 days: ${
      workouts?.length ? workouts.map((w) => `${w.performed_on} ${w.title}`).join("; ") : "none logged"
    }`,
    `Meals logged last 7 days: ${meals?.length ?? 0} entries, avg ${avgCalories(meals ?? [])} kcal/day on logged days.`,
    homeContext,
    `Goals: ${JSON.stringify(profile.settings)}`,
  ].join("\n");

  const { text } = await provider.chat({
    temperature: 0.5,
    // The plan JSON fits comfortably in ~600 tokens; the cap stops a slow
    // model from padding the response and doubling the wait.
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content:
          "You are a personal secretary composing a concise morning plan. " +
          "Respond with ONLY a JSON object: { overview: string (2 warm sentences), " +
          "priorities: string[] (top 5 max, drawn from tasks, calendar, AND household duties — e.g. 'Take recycling out tonight' belongs alongside meetings), " +
          "workout: string (one concrete suggestion respecting recent training and rest), " +
          "nutrition: string (one concrete suggestion toward the goals), " +
          "freeWindows: string[] (gaps between events, e.g. '14:00–16:30'), " +
          "home: string (one line on today's household picture: chores, collections, shopping — or '' if none), " +
          "schedule: [{start:'HH:MM', end:'HH:MM', title: string}] (max 5 time blocks placing the priorities and the workout INSIDE the free windows — 24h local times, never overlapping existing calendar events, [] if the day is already full) }. No markdown fences.",
      },
      { role: "user", content: context },
    ],
  });

  const parsed = parsePlanJSON(text);
  const plan: DailyPlan = {
    date: planDate,
    ...parsed,
    bedtime: `${sleep.bedtime} (wind down ${sleep.windDownStart}, wake ${sleep.wake}) — ${sleep.rationale}`,
  };

  const { error: saveError } = await supabase
    .from("daily_plans")
    .upsert({ user_id: profile.id, plan_date: planDate, plan });
  if (saveError) {
    throw new Error(`The plan was composed but could not be saved: ${saveError.message}`);
  }

  const createdEvents: string[] = [];
  const createdTasks: string[] = [];
  if (materialize) {
    // ── Time blocks → real Google Calendar events (created in parallel) ──
    if (accessToken) {
      const nowLocal = new Date().toLocaleTimeString("en-GB", {
        timeZone: tz, hour: "2-digit", minute: "2-digit",
      });
      const existingTitles = new Set(events.map((e) => e.summary.toLowerCase().trim()));
      const blocks = parsed.schedule.filter((block) => {
        if (block.end <= block.start) return false;
        // Skip blocks already behind us (when planning today mid-day) and
        // blocks whose title already exists on today's calendar (re-planning
        // the same day must not duplicate).
        if (planDate === localDateStr(tz) && block.start < nowLocal) return false;
        return !existingTitles.has(block.title.toLowerCase().trim());
      });
      const settled = await Promise.allSettled(
        blocks.map((block) =>
          createEvent(accessToken, {
            summary: block.title,
            startISO: zonedTimeToUtc(planDate, block.start, tz).toISOString(),
            endISO: zonedTimeToUtc(planDate, block.end, tz).toISOString(),
            description: "Scheduled by Caffeinatd — daily plan",
          }),
        ),
      );
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") createdEvents.push(`${blocks[i]!.start} ${blocks[i]!.title}`);
      });
    }

    // ── Priorities without a matching open task → tasks (one batch insert) ─
    const openTitles = (tasks ?? []).map((t) => t.title.toLowerCase().trim());
    const newPriorities = parsed.priorities.filter((priority) => {
      const p = priority.toLowerCase().trim();
      return !openTitles.some((t) => t.includes(p) || p.includes(t));
    });
    if (newPriorities.length > 0) {
      const { error: taskError } = await supabase.from("tasks").insert(
        newPriorities.map((title) => ({
          user_id: profile.id,
          title,
          priority: 2,
          category: "daily plan",
          due_at: endOfDayISO(planDate, tz),
        })),
      );
      if (!taskError) createdTasks.push(...newPriorities);
    }
  }

  return { plan, createdEvents, createdTasks, calendarConnected: Boolean(accessToken) };
}

function parsePlanJSON(text: string): z.infer<typeof planSchema> {
  // Models wrap JSON in fences or add commentary despite instructions; take
  // the outermost brace span and tolerate trailing commas before giving up.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    for (const candidate of [match[0], match[0].replace(/,\s*([}\]])/g, "$1")]) {
      try {
        return planSchema.parse(JSON.parse(candidate));
      } catch {
        // try the next repair
      }
    }
  }
  // Fail loud rather than persisting a hollow plan the UI would show as success.
  throw new Error("The AI returned a plan I couldn't read, so nothing was saved. Ask me to plan your day again.");
}

function assigneeName(chore: Chore, home: HomeData): string | null {
  return nextAssignee(chore, home.members, home.completions)?.name ?? null;
}

function avgCalories(meals: { eaten_at: string; calories: number | null }[]): number {
  const byDay = new Map<string, number>();
  for (const m of meals) {
    const day = m.eaten_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (m.calories ?? 0));
  }
  if (byDay.size === 0) return 0;
  return Math.round([...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size);
}

function formatTime24(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
}
