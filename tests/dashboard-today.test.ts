import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  sumMacros,
  greetingFor,
  countOpenTasksByWorkspace,
} from "@/lib/dashboard/today";
import { CalendarEvent } from "@/lib/types";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e1",
  calendarId: "primary",
  calendarSummary: "me@example.com",
  isPrimary: true,
  summary: "Standup",
  start: "2024-06-03T13:00:00Z",
  end: "2024-06-03T13:30:00Z",
  location: undefined,
  allDay: false,
  ...over,
});

describe("buildTimeline", () => {
  it("maps events and carries a non-primary calendar as the sub", () => {
    const items = buildTimeline([event({ isPrimary: false, calendarSummary: "Family" })], undefined, "2024-06-03", "UTC");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Standup", kind: "event", sub: "Family" });
  });

  it("leaves the sub undefined for primary-calendar events", () => {
    const items = buildTimeline([event({})], undefined, "2024-06-03", "UTC");
    expect(items[0]?.sub).toBeUndefined();
  });

  it("converts plan blocks' local times to instants in the user's tz", () => {
    const items = buildTimeline([], [{ start: "09:00", end: "10:00", title: "Deep work" }], "2024-06-03", "America/New_York");
    expect(items[0]).toMatchObject({ kind: "block", title: "Deep work" });
    // 09:00 EDT on 2024-06-03 is 13:00 UTC.
    expect(items[0]?.start).toBe("2024-06-03T13:00:00.000Z");
  });

  it("merges events and blocks into one list", () => {
    const items = buildTimeline([event({})], [{ start: "09:00", end: "10:00", title: "Deep work" }], "2024-06-03", "UTC");
    expect(items.map((i) => i.kind)).toEqual(["event", "block"]);
  });
});

describe("sumMacros", () => {
  it("sums calories and macros, tolerating nulls", () => {
    expect(
      sumMacros([
        { calories: 500, protein_g: 40, carbs_g: 50, fat_g: 10 },
        { calories: null, protein_g: 20, carbs_g: null, fat_g: 5 },
      ]),
    ).toEqual({ kcal: 500, p: 60, c: 50, f: 15 });
  });

  it("is zero for an empty day", () => {
    expect(sumMacros([])).toEqual({ kcal: 0, p: 0, c: 0, f: 0 });
  });
});

describe("greetingFor", () => {
  it("buckets the day at noon and 6pm", () => {
    expect(greetingFor(6).greeting).toBe("Good morning");
    expect(greetingFor(11).greeting).toBe("Good morning");
    expect(greetingFor(12).greeting).toBe("Good afternoon");
    expect(greetingFor(17).greeting).toBe("Good afternoon");
    expect(greetingFor(18).greeting).toBe("Good evening");
    expect(greetingFor(23).greeting).toBe("Good evening");
  });
});

describe("countOpenTasksByWorkspace", () => {
  it("tallies per workspace and skips null workspaces", () => {
    expect(
      countOpenTasksByWorkspace([
        { workspace_id: "a" },
        { workspace_id: "a" },
        { workspace_id: "b" },
        { workspace_id: null },
      ]),
    ).toEqual({ a: 2, b: 1 });
  });
});
