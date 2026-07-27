import { describe, expect, it } from "vitest";
import {
  atOrOverCap,
  capEnforced,
  evaluateCaps,
  localDay,
  localMonth,
  monthRange,
} from "@/lib/notifications/limits";

describe("local period bucketing (user timezone, not UTC)", () => {
  it("assigns a late-UTC moment to the correct local day west of UTC", () => {
    // 03:30 UTC on the 27th is 23:30 on the 26th in New York (EDT, −4).
    const t = new Date("2026-07-27T03:30:00Z");
    expect(localDay(t, "America/New_York")).toBe("2026-07-26");
    expect(localDay(t, "UTC")).toBe("2026-07-27");
  });

  it("rolls the day over at LOCAL midnight across a US DST spring-forward", () => {
    // DST begins 2026-03-08 in the US (clocks 02:00→03:00 local).
    // 06:30 UTC = 01:30 EST (still the 8th, pre-jump).
    expect(localDay(new Date("2026-03-08T06:30:00Z"), "America/New_York")).toBe("2026-03-08");
    // 07:30 UTC = 03:30 EDT — same local day, past the skipped hour.
    expect(localDay(new Date("2026-03-08T07:30:00Z"), "America/New_York")).toBe("2026-03-08");
    // 04:30 UTC = 23:30 EST on the 7th — the previous local day.
    expect(localDay(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
  });

  it("derives the local month and a half-open month range", () => {
    const t = new Date("2026-07-27T12:00:00Z");
    expect(localMonth(t, "UTC")).toBe("2026-07");
    expect(monthRange(t, "UTC")).toEqual({ start: "2026-07-01", endExclusive: "2026-08-01" });
  });

  it("wraps the month range across the year boundary", () => {
    const dec = new Date("2026-12-15T12:00:00Z");
    expect(monthRange(dec, "UTC")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
  });
});

describe("cap arithmetic", () => {
  it("treats <= 0 as unlimited", () => {
    expect(capEnforced(0)).toBe(false);
    expect(capEnforced(-1)).toBe(false);
    expect(capEnforced(5)).toBe(true);
    expect(atOrOverCap(100, 0)).toBe(false); // unlimited never blocks
  });

  it("blocks at exactly the cap, not one before", () => {
    expect(atOrOverCap(4, 5)).toBe(false);
    expect(atOrOverCap(5, 5)).toBe(true);
    expect(atOrOverCap(6, 5)).toBe(true);
  });
});

describe("evaluateCaps", () => {
  const caps = { daily: 5, monthly: 20 };

  it("passes under both caps", () => {
    expect(evaluateCaps({ sentToday: 2, sentMonth: 10, inFlight: 0 }, caps)).toEqual({
      blocked: false,
      reason: null,
    });
  });

  it("counts in-flight messages toward the cap (bounds a burst)", () => {
    // 4 sent + 1 in-flight = 5 = daily cap → the next one is blocked.
    expect(evaluateCaps({ sentToday: 4, sentMonth: 10, inFlight: 1 }, caps)).toEqual({
      blocked: true,
      reason: "daily",
    });
  });

  it("reports the monthly cap when only it is breached", () => {
    expect(evaluateCaps({ sentToday: 1, sentMonth: 20, inFlight: 0 }, caps)).toEqual({
      blocked: true,
      reason: "monthly",
    });
  });
});
