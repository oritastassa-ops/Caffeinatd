import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSituationBrief, type CalendarFetcher } from "@/lib/pipeline/context";
import { CalendarEvent, Profile } from "@/lib/types";

const TZ = "America/Toronto";
const NOW = new Date("2026-07-29T16:00:00Z"); // 12:00 local Toronto (EDT)

/** ~4 chars/token — the same estimate the phase's budget is stated in. */
const estTokens = (s: string) => Math.round(s.length / 4);

function ev(start: string, end: string, summary: string): CalendarEvent {
  return { id: summary, calendarId: "primary", calendarSummary: "primary", isPrimary: true, summary, start, end, allDay: false };
}

/** Minimal fake: every table resolves to preloaded rows, filters are no-ops. */
function fakeDb(data: Record<string, Record<string, unknown>[]>): SupabaseClient {
  const make = (rows: Record<string, unknown>[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gte", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.then = (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res);
    return b;
  };
  return { from: (t: string) => make(data[t] ?? []) } as unknown as SupabaseClient;
}

const profile: Profile = {
  id: "user-uuid-should-never-appear",
  display_name: "Ori",
  timezone: TZ,
  settings: { calorieGoal: 2200, proteinGoal: 150, sleepHours: 8, trainingProgramId: "ppl", weeklyWorkoutTarget: 4 },
  onboarded_at: null,
};

const calendarWith =
  (today: CalendarEvent[], tomorrow: CalendarEvent[]): CalendarFetcher =>
  async () => ({ today, tomorrow, connected: true });

const noCalendar: CalendarFetcher = async () => ({ today: [], tomorrow: [], connected: false });

describe("buildSituationBrief", () => {
  it("assembles every section and stays within the token budget", async () => {
    const db = fakeDb({
      daily_plans: [{ plan: { overview: "A busy but doable day.", priorities: ["Submit lab report", "Email Dr. Chen"], freeWindows: ["12:00–14:00"] } }],
      tasks: Array.from({ length: 10 }, (_, i) => ({ title: `Task ${i + 1}`, priority: (i % 4) + 1, due_at: i === 0 ? "2026-07-28T00:00:00Z" : null })),
      meals: [{ protein_g: 40 }],
      workouts: [],
    });
    const brief = await buildSituationBrief(db, profile, {
      now: NOW,
      fetchCalendar: calendarWith(
        [ev("2026-07-29T13:00:00Z", "2026-07-29T14:00:00Z", "Standup"), ev("2026-07-29T18:00:00Z", "2026-07-29T19:00:00Z", "Dentist")],
        [ev("2026-07-30T14:00:00Z", "2026-07-30T15:00:00Z", "Lecture")],
      ),
    });

    expect(brief).toContain("Today: Wednesday 2026-07-29");
    expect(brief).toContain("Readiness");
    expect(brief).toContain("Today's plan:");
    expect(brief).toContain("Standup");
    expect(brief).toContain("Calendar tomorrow:");
    expect(brief).toContain("Lecture");
    expect(brief).toContain("Open tasks:");
    expect(brief).toContain("+2 more"); // 10 tasks, top 8 shown
    expect(brief).toContain("Goals:");
    expect(brief).toContain("2200 kcal");
    expect(brief).toContain("Push / Pull / Legs");

    // Budget: the whole brief must fit the stated ~600–900 token envelope.
    expect(estTokens(brief)).toBeLessThanOrEqual(900);
  });

  it("returns empty string for a brand-new account (no plan, tasks, or calendar)", async () => {
    const db = fakeDb({ daily_plans: [], tasks: [], meals: [], workouts: [] });
    const brief = await buildSituationBrief(db, { ...profile, settings: {} }, { now: NOW, fetchCalendar: noCalendar });
    expect(brief).toBe("");
  });

  it("omits sections whose data is absent — never renders 'none' noise", async () => {
    const db = fakeDb({
      daily_plans: [{ plan: { overview: "Light day.", priorities: ["Rest"], freeWindows: [] } }],
      tasks: [],
      meals: [],
      workouts: [],
    });
    const brief = await buildSituationBrief(db, { ...profile, settings: {} }, { now: NOW, fetchCalendar: noCalendar });
    expect(brief).toContain("Today's plan:");
    expect(brief).not.toContain("Calendar today:");
    expect(brief).not.toContain("Open tasks:");
    expect(brief).not.toContain("none");
    expect(brief).not.toContain("Goals:"); // settings cleared
  });

  it("leaks no identifier beyond what the prompt already carried", async () => {
    const db = fakeDb({
      daily_plans: [{ plan: { overview: "x", priorities: [], freeWindows: [] } }],
      tasks: [{ title: "T", priority: 1, due_at: null }],
      meals: [],
      workouts: [],
    });
    const brief = await buildSituationBrief(db, profile, { now: NOW, fetchCalendar: noCalendar });
    expect(brief).not.toContain(profile.id); // user id never appears
  });
});
