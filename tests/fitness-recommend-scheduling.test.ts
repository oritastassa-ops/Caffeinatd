import { describe, expect, it } from "vitest";
import { recommendNextWorkout } from "@/lib/fitness/recommend";
import { findFreeSlot } from "@/lib/fitness/scheduling";
import { MuscleRecovery } from "@/lib/fitness/recovery";
import { CalendarEvent } from "@/lib/types";

describe("recommendNextWorkout", () => {
  function recovery(overrides: Partial<MuscleRecovery>): MuscleRecovery {
    return { group: "chest", percent: 100, label: "Ready", detail: "", lastTrainedOn: "2026-07-01", ...overrides };
  }

  it("recommends rest when nothing is at least Recovering", () => {
    const rec = recommendNextWorkout([recovery({ percent: 20, label: "Fatigued" })]);
    expect(rec.label).toBe("Rest day");
  });

  it("picks the group trained longest ago among ready candidates", () => {
    const rec = recommendNextWorkout([
      recovery({ group: "chest", percent: 100, lastTrainedOn: "2026-07-01" }),
      recovery({ group: "legs", percent: 100, lastTrainedOn: "2026-06-20" }),
    ]);
    expect(rec.label).toBe("Legs");
  });

  it("prefers a never-trained group", () => {
    const rec = recommendNextWorkout([
      recovery({ group: "chest", percent: 100, lastTrainedOn: "2026-07-01" }),
      recovery({ group: "arms", percent: 100, lastTrainedOn: null }),
    ]);
    expect(rec.label).toBe("Arms");
  });
});

describe("findFreeSlot", () => {
  const day = "2026-07-11"; // a Saturday

  it("finds the first gap that fits the requested duration", () => {
    const events: CalendarEvent[] = [
      ev("a", `${day}T09:00:00`, `${day}T10:00:00`),
      ev("b", `${day}T13:00:00`, `${day}T14:00:00`),
    ];
    // 07:00-09:00 is a 120min gap before the first event — big enough for a 90min ask.
    const slot = findFreeSlot(events, 90);
    expect(slot).not.toBeNull();
    expect(slot!.start).toBe("07:00");
  });

  it("skips a too-small gap and finds the next one that fits", () => {
    const events: CalendarEvent[] = [
      ev("a", `${day}T07:30:00`, `${day}T09:00:00`), // leaves only 30min before it — too small for 90min
      ev("b", `${day}T10:30:00`, `${day}T13:00:00`),
    ];
    const slot = findFreeSlot(events, 90);
    expect(slot!.start).toBe("09:00"); // the 09:00-10:30 gap fits
  });

  it("returns null when the day is fully booked", () => {
    const events: CalendarEvent[] = [ev("a", `${day}T07:00:00`, `${day}T21:00:00`)];
    expect(findFreeSlot(events, 60)).toBeNull();
  });

  it("finds a slot before the first event when the morning is open", () => {
    const events: CalendarEvent[] = [ev("a", `${day}T12:00:00`, `${day}T13:00:00`)];
    const slot = findFreeSlot(events, 60);
    expect(slot!.start).toBe("07:00");
  });
});

function ev(id: string, start: string, end: string): CalendarEvent {
  return {
    id,
    calendarId: "primary",
    calendarSummary: "primary",
    isPrimary: true,
    summary: id,
    start,
    end,
    allDay: false,
  };
}
