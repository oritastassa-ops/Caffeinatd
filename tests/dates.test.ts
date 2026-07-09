import { describe, expect, it } from "vitest";
import { zonedTimeToUtc, localDateStr } from "@/lib/utils";
import { findConflicts } from "@/lib/google/calendar";

describe("timezone math", () => {
  it("converts local wall-clock to UTC (winter, UTC+2)", () => {
    const d = zonedTimeToUtc("2026-01-15", "15:00", "Asia/Jerusalem");
    expect(d.toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });

  it("handles DST (summer, UTC+3)", () => {
    const d = zonedTimeToUtc("2026-07-15", "15:00", "Asia/Jerusalem");
    expect(d.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("handles negative offsets", () => {
    const d = zonedTimeToUtc("2026-01-15", "15:00", "America/New_York");
    expect(d.toISOString()).toBe("2026-01-15T20:00:00.000Z");
  });

  it("formats a local date string", () => {
    const d = new Date("2026-01-15T23:30:00Z"); // 01:30 Jan 16 in Jerusalem
    expect(localDateStr("Asia/Jerusalem", d)).toBe("2026-01-16");
  });
});

describe("conflict detection", () => {
  const busy = [
    { start: "2026-07-09T14:00:00Z", end: "2026-07-09T15:00:00Z" },
    { start: "2026-07-09T18:00:00Z", end: "2026-07-09T19:00:00Z" },
  ];

  it("finds overlapping intervals", () => {
    expect(findConflicts(busy, "2026-07-09T14:30:00Z", "2026-07-09T15:30:00Z")).toHaveLength(1);
  });

  it("treats back-to-back events as non-conflicting", () => {
    expect(findConflicts(busy, "2026-07-09T15:00:00Z", "2026-07-09T16:00:00Z")).toHaveLength(0);
  });

  it("catches an event fully containing a busy block", () => {
    expect(findConflicts(busy, "2026-07-09T13:00:00Z", "2026-07-09T20:00:00Z")).toHaveLength(2);
  });
});
