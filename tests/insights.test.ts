import { describe, expect, it } from "vitest";
import { computeInsightCandidates } from "@/lib/insights/generate";
import { Profile } from "@/lib/types";

const profile: Profile = {
  id: "u1",
  display_name: "Sarah",
  timezone: "UTC",
  settings: { weeklyWorkoutTarget: 3, proteinGoal: 150 },
  onboarded_at: null,
};

describe("insight generation (deterministic rules)", () => {
  it("flags a missed workout week only past midweek", () => {
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows: [],
      todayProteinG: 0,
      todayEvents: [],
      overdueTaskCount: 0,
    });
    const fitness = candidates.filter((c) => c.domain === "fitness");
    // "today" is whenever the test runs — assert the rule fires consistently
    // with its own midweek gate rather than hardcoding a day.
    const dayOfWeek = new Date().getUTCDay();
    if (dayOfWeek >= 3) {
      expect(fitness).toHaveLength(1);
      expect(fitness[0]!.dedupKey).toMatch(/^fitness:missed_week:/);
    } else {
      expect(fitness).toHaveLength(0);
    }
  });

  it("does not flag fitness when the weekly target isn't set meaningfully", () => {
    const noTarget: Profile = { ...profile, settings: { weeklyWorkoutTarget: 1 } };
    const candidates = computeInsightCandidates(noTarget, {
      workouts: [],
      setRows: [],
      todayProteinG: 0,
      todayEvents: [],
      overdueTaskCount: 0,
    });
    expect(candidates.filter((c) => c.domain === "fitness")).toHaveLength(0);
  });

  it("flags overdue tasks at 3 or more", () => {
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows: [],
      todayProteinG: 0,
      todayEvents: [],
      overdueTaskCount: 3,
    });
    const tasks = candidates.filter((c) => c.domain === "tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.message).toContain("3 overdue");
  });

  it("does not flag tasks below the threshold", () => {
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows: [],
      todayProteinG: 0,
      todayEvents: [],
      overdueTaskCount: 2,
    });
    expect(candidates.filter((c) => c.domain === "tasks")).toHaveLength(0);
  });

  it("detects overlapping calendar events regardless of time of day", () => {
    const overlapping = [
      { id: "a", calendarId: "primary", calendarSummary: "p", isPrimary: true, summary: "A", start: "2026-07-06T14:00:00Z", end: "2026-07-06T15:00:00Z", allDay: false },
      { id: "b", calendarId: "primary", calendarSummary: "p", isPrimary: true, summary: "B", start: "2026-07-06T14:30:00Z", end: "2026-07-06T15:30:00Z", allDay: false },
    ];
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows: [],
      todayProteinG: 0,
      todayEvents: overlapping,
      overdueTaskCount: 0,
    });
    expect(candidates.some((c) => c.dedupKey.startsWith("calendar:overlap:"))).toBe(true);
  });

  it("produces a stable dedup key so re-running generation doesn't duplicate", () => {
    const run1 = computeInsightCandidates(profile, { workouts: [], setRows: [], todayProteinG: 0, todayEvents: [], overdueTaskCount: 5 });
    const run2 = computeInsightCandidates(profile, { workouts: [], setRows: [], todayProteinG: 0, todayEvents: [], overdueTaskCount: 5 });
    expect(run1.find((c) => c.domain === "tasks")?.dedupKey).toBe(run2.find((c) => c.domain === "tasks")?.dedupKey);
  });

  it("suggests scheduling a workout when a muscle group is ready and today has a free block", () => {
    const setRows = [{ exercise: "Squat", performed_on: "2026-05-01", reps: 5, weight_kg: 100 }]; // long recovered
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows,
      todayProteinG: 0,
      todayEvents: [], // fully free today
      overdueTaskCount: 0,
    });
    const scheduling = candidates.find((c) => c.dedupKey.startsWith("fitness:schedule:"));
    expect(scheduling).toBeDefined();
    expect(scheduling!.actionPreset).toContain("schedule");
  });

  it("does not suggest scheduling when there's no free block", () => {
    const setRows = [{ exercise: "Squat", performed_on: "2026-05-01", reps: 5, weight_kg: 100 }];
    const bookedAllDay = [
      { id: "a", calendarId: "primary", calendarSummary: "p", isPrimary: true, summary: "Busy", start: `${new Date().toISOString().slice(0, 10)}T07:00:00`, end: `${new Date().toISOString().slice(0, 10)}T21:00:00`, allDay: false },
    ];
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows,
      todayProteinG: 0,
      todayEvents: bookedAllDay,
      overdueTaskCount: 0,
    });
    expect(candidates.some((c) => c.dedupKey.startsWith("fitness:schedule:"))).toBe(false);
  });

  it("flags a plateaued exercise with no progress over the last month", () => {
    // Dates are relative to now: the plateau rule compares the last 30 days
    // against the 30–60 days before that, so absolute dates age out of the window.
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const setRows = [
      { exercise: "Bench Press", performed_on: daysAgo(10), reps: 5, weight_kg: 90 }, // last 30d
      { exercise: "Bench Press", performed_on: daysAgo(45), reps: 5, weight_kg: 100 }, // 30–60d ago, was heavier
    ];
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows,
      todayProteinG: 0,
      todayEvents: [],
      overdueTaskCount: 0,
    });
    expect(candidates.some((c) => c.dedupKey.startsWith("fitness:plateau:"))).toBe(true);
  });

  it("does not flag a plateau when the exercise is progressing", () => {
    const setRows = [
      { exercise: "Bench Press", performed_on: "2026-07-01", reps: 5, weight_kg: 110 },
      { exercise: "Bench Press", performed_on: "2026-05-20", reps: 5, weight_kg: 100 },
    ];
    const candidates = computeInsightCandidates(profile, {
      workouts: [],
      setRows,
      todayProteinG: 0,
      todayEvents: [],
      overdueTaskCount: 0,
    });
    expect(candidates.some((c) => c.dedupKey.startsWith("fitness:plateau:"))).toBe(false);
  });
});
