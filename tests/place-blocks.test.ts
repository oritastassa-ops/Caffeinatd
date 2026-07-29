import { describe, expect, it } from "vitest";
import {
  busyIntervals,
  freeWindows,
  hhmmToMin,
  minToHHMM,
  placeBlocks,
} from "@/lib/planning/place-blocks";
import { zonedTimeToUtc } from "@/lib/utils";
import { CalendarEvent } from "@/lib/types";

const TZ = "America/Toronto";

function ev(startISO: string, endISO: string, summary = "Event", allDay = false): CalendarEvent {
  return {
    id: summary,
    calendarId: "primary",
    calendarSummary: "primary",
    isPrimary: true,
    summary,
    start: startISO,
    end: endISO,
    allDay,
  };
}

describe("busyIntervals", () => {
  it("reads local wall-clock minutes for timed events (EDT)", () => {
    // 09:00–10:00 and 14:00–15:00 local Toronto (UTC-4 in July).
    const events = [
      ev("2026-07-29T13:00:00Z", "2026-07-29T14:00:00Z", "Standup"),
      ev("2026-07-29T18:00:00Z", "2026-07-29T19:00:00Z", "Dentist"),
    ];
    expect(busyIntervals(events, TZ, "2026-07-29")).toEqual([
      { start: 540, end: 600 },
      { start: 840, end: 900 },
    ]);
  });

  it("ignores all-day events and merges overlaps", () => {
    const events = [
      ev("2026-07-29T00:00:00Z", "2026-07-30T00:00:00Z", "Holiday", true),
      ev("2026-07-29T13:00:00Z", "2026-07-29T14:30:00Z", "A"),
      ev("2026-07-29T14:00:00Z", "2026-07-29T15:00:00Z", "B"), // overlaps A
    ];
    expect(busyIntervals(events, TZ, "2026-07-29")).toEqual([{ start: 540, end: 660 }]);
  });
});

describe("freeWindows", () => {
  const busy = [
    { start: 540, end: 600 }, // 09:00–10:00
    { start: 840, end: 900 }, // 14:00–15:00
  ];

  it("returns the gaps within the day, respecting minLen", () => {
    expect(freeWindows(busy, 480, 1320, 480, 30)).toEqual([
      { start: 480, end: 540 }, // 08:00–09:00
      { start: 600, end: 840 }, // 10:00–14:00
      { start: 900, end: 1320 }, // 15:00–22:00
    ]);
  });

  it("clips everything before `after` (a mid-day re-plan never schedules the past)", () => {
    expect(freeWindows(busy, 480, 1320, 1000, 30)).toEqual([{ start: 1000, end: 1320 }]);
  });

  it("drops gaps shorter than minLen", () => {
    // 10-minute gap between 600 and 610 is below the 30-min floor.
    const tight = [{ start: 480, end: 600 }, { start: 610, end: 1320 }];
    expect(freeWindows(tight, 480, 1320, 480, 30)).toEqual([]);
  });
});

describe("placeBlocks", () => {
  it("lays items into a window back-to-back, in order, without crossing its end", () => {
    const blocks = placeBlocks([{ start: 600, end: 840 }], [
      { title: "A", durationMin: 45 },
      { title: "B", durationMin: 45 },
      { title: "C", durationMin: 45 },
    ]);
    expect(blocks).toEqual([
      { start: 600, end: 645, title: "A" },
      { start: 645, end: 690, title: "B" },
      { start: 690, end: 735, title: "C" },
    ]);
  });

  it("never overflows a window and moves leftover items to the next", () => {
    const blocks = placeBlocks(
      [
        { start: 480, end: 540 }, // 60 min → fits one 45-min block
        { start: 900, end: 1320 },
      ],
      [
        { title: "A", durationMin: 45 },
        { title: "B", durationMin: 45 },
      ],
    );
    expect(blocks[0]).toEqual({ start: 480, end: 525, title: "A" });
    expect(blocks[1]).toEqual({ start: 900, end: 945, title: "B" });
    // Every block stays inside a free window → never overlaps a real event.
    for (const b of blocks) expect(b.end - b.start).toBe(45);
  });

  it("places nothing when no window is long enough", () => {
    expect(placeBlocks([{ start: 480, end: 500 }], [{ title: "A", durationMin: 45 }])).toEqual([]);
  });
});

describe("placement → UTC is DST-safe", () => {
  it("converts a 14:00 block correctly on both DST sides (Toronto)", () => {
    // Spring (EDT, UTC-4): 14:00 → 18:00Z. Fall (EST, UTC-5): 14:00 → 19:00Z.
    const spring = zonedTimeToUtc("2026-07-29", minToHHMM(hhmmToMin("14:00")), TZ);
    const fall = zonedTimeToUtc("2026-12-15", minToHHMM(hhmmToMin("14:00")), TZ);
    expect(spring.toISOString()).toBe("2026-07-29T18:00:00.000Z");
    expect(fall.toISOString()).toBe("2026-12-15T19:00:00.000Z");
  });

  it("round-trips minutes through HH:MM", () => {
    expect(minToHHMM(hhmmToMin("09:05"))).toBe("09:05");
    expect(minToHHMM(hhmmToMin("00:00"))).toBe("00:00");
    expect(minToHHMM(hhmmToMin("23:59"))).toBe("23:59");
  });
});
