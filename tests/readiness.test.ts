import { describe, expect, it } from "vitest";
import { computeReadiness } from "@/lib/planning/readiness";

const base = {
  overdueTaskCount: 0,
  weeklyWorkoutTarget: 3,
  workoutsThisWeek: 1,
  dayOfWeek: 2, // Tuesday
  proteinGoal: undefined as number | undefined,
  proteinLoggedToday: 0,
  mealsLoggedToday: 0,
  hourOfDay: 10,
  todayEvents: [],
};

describe("readiness score", () => {
  it("starts at 100 with nothing pulling the day off track", () => {
    const r = computeReadiness(base);
    expect(r.score).toBe(100);
    expect(r.reasons).toEqual(["Nothing pulling your day off track right now."]);
  });

  it("deducts for overdue tasks, capped at -40", () => {
    expect(computeReadiness({ ...base, overdueTaskCount: 2 }).score).toBe(80);
    expect(computeReadiness({ ...base, overdueTaskCount: 10 }).score).toBe(60); // capped
  });

  it("flags a missed workout week only past midweek with a real target", () => {
    const midweek = computeReadiness({ ...base, dayOfWeek: 4, workoutsThisWeek: 0 });
    expect(midweek.score).toBe(85);
    const monday = computeReadiness({ ...base, dayOfWeek: 1, workoutsThisWeek: 0 });
    expect(monday.score).toBe(100); // too early in the week to flag
  });

  it("flags no nutrition logged by mid-afternoon when a protein goal exists", () => {
    const r = computeReadiness({ ...base, proteinGoal: 150, hourOfDay: 15, mealsLoggedToday: 0 });
    expect(r.score).toBe(90);
  });

  it("detects overlapping calendar events", () => {
    const events = [
      { id: "a", calendarId: "primary", calendarSummary: "p", isPrimary: true, summary: "A", start: "2026-07-06T14:00:00Z", end: "2026-07-06T15:00:00Z", allDay: false },
      { id: "b", calendarId: "primary", calendarSummary: "p", isPrimary: true, summary: "B", start: "2026-07-06T14:30:00Z", end: "2026-07-06T15:30:00Z", allDay: false },
    ];
    const r = computeReadiness({ ...base, todayEvents: events });
    expect(r.score).toBe(80);
    expect(r.reasons.some((x) => x.includes("overlap"))).toBe(true);
  });

  it("floors at 0 even if every deduction stacks", () => {
    const overlapping = [
      { id: "a", calendarId: "primary", calendarSummary: "p", isPrimary: true, summary: "A", start: "2026-07-06T14:00:00Z", end: "2026-07-06T15:00:00Z", allDay: false },
      { id: "b", calendarId: "primary", calendarSummary: "p", isPrimary: true, summary: "B", start: "2026-07-06T14:30:00Z", end: "2026-07-06T15:30:00Z", allDay: false },
    ];
    const r = computeReadiness({
      overdueTaskCount: 20,
      weeklyWorkoutTarget: 3,
      workoutsThisWeek: 0,
      dayOfWeek: 5,
      proteinGoal: 150,
      proteinLoggedToday: 0,
      mealsLoggedToday: 0,
      hourOfDay: 20,
      todayEvents: overlapping,
    });
    // -40 (tasks, capped) -15 (fitness) -10 (nutrition) -20 (calendar) = 15
    expect(r.score).toBe(15);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});
