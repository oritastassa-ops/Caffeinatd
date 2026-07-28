import { describe, it, expect } from "vitest";
import {
  dayWindow,
  resolveDayEvents,
  layoutDay,
  type ResolvedEvent,
} from "@/lib/calendar/layout";

// ── layoutDay: pure column packing ───────────────────────────────────────────

type Box = { id: string };
const box = (id: string, startMin: number, endMin: number): ResolvedEvent<Box> => ({
  event: { id },
  startMin,
  endMin,
});

/** Index the packed boxes by event id (layoutDay may reorder). */
function pack(resolved: ResolvedEvent<Box>[], minDurationMin = 0) {
  const out = layoutDay(resolved, { minDurationMin });
  return new Map(out.map((b) => [b.event.id, b]));
}

describe("layoutDay — width and columns", () => {
  it("non-overlapping events keep full width", () => {
    const m = pack([box("a", 0, 60), box("b", 120, 180)]);
    expect(m.get("a")).toMatchObject({ left: 0, width: 1, columns: 1 });
    expect(m.get("b")).toMatchObject({ left: 0, width: 1, columns: 1 });
  });

  it("two overlapping events split 50/50", () => {
    const m = pack([box("a", 0, 60), box("b", 30, 90)]);
    expect(m.get("a")).toMatchObject({ left: 0, width: 0.5, columns: 2, column: 0 });
    expect(m.get("b")).toMatchObject({ left: 0.5, width: 0.5, columns: 2, column: 1 });
  });

  it("three mutually overlapping events split in thirds", () => {
    const m = pack([box("a", 0, 180), box("b", 30, 150), box("c", 60, 120)]);
    for (const id of ["a", "b", "c"]) expect(m.get(id)!.width).toBeCloseTo(1 / 3);
    expect(m.get("a")!.left).toBeCloseTo(0);
    expect(m.get("b")!.left).toBeCloseTo(1 / 3);
    expect(m.get("c")!.left).toBeCloseTo(2 / 3);
  });

  it("partial-overlap chain (A–B, B–C, A∦C) shares a column, not thirds", () => {
    // A overlaps B, B overlaps C, but A and C do NOT overlap. The cluster is
    // two columns wide; A and C share column 0 at half width. Naive code that
    // counts the cluster size gives thirds — that's the bug this guards.
    const m = pack([box("a", 0, 60), box("b", 30, 90), box("c", 60, 120)]);
    expect(m.get("a")).toMatchObject({ left: 0, width: 0.5, column: 0 });
    expect(m.get("b")).toMatchObject({ left: 0.5, width: 0.5, column: 1 });
    expect(m.get("c")).toMatchObject({ left: 0, width: 0.5, column: 0 });
  });

  it("a separate cluster resets to full width", () => {
    // Two overlap early, one stands alone later.
    const m = pack([box("a", 0, 60), box("b", 30, 90), box("c", 200, 260)]);
    expect(m.get("a")!.width).toBe(0.5);
    expect(m.get("c")).toMatchObject({ width: 1, columns: 1 });
  });
});

describe("layoutDay — minimum footprint", () => {
  it("zero-duration events get a minimum clickable height", () => {
    const m = pack([box("a", 600, 600)], 15);
    const a = m.get("a")!;
    expect(a.endMin - a.startMin).toBe(15);
  });

  it("very short events are floored to the minimum too", () => {
    const m = pack([box("a", 600, 605)], 15);
    expect(m.get("a")!.endMin).toBe(615);
  });

  it("does not shrink events already longer than the minimum", () => {
    const m = pack([box("a", 600, 700)], 15);
    expect(m.get("a")!.endMin).toBe(700);
  });
});

// ── dayWindow: DST-aware day length ──────────────────────────────────────────

describe("dayWindow — DST day length", () => {
  const TZ = "America/New_York";

  it("a normal day is 1440 minutes", () => {
    expect(dayWindow("2024-06-01", TZ).lengthMin).toBe(1440);
  });

  it("spring-forward day is 23 hours (1380 minutes)", () => {
    expect(dayWindow("2024-03-10", TZ).lengthMin).toBe(1380);
  });

  it("fall-back day is 25 hours (1500 minutes)", () => {
    expect(dayWindow("2024-11-03", TZ).lengthMin).toBe(1500);
  });
});

// ── resolveDayEvents: timezone, clipping, DST offsets ────────────────────────

const timed = (start: string, end: string) => ({ start, end, allDay: false });

describe("resolveDayEvents — timezone and clipping", () => {
  const TZ = "America/New_York";

  it("positions an event by its wall-clock time in the user's timezone", () => {
    const r = resolveDayEvents([timed("2024-06-01T09:00:00-04:00", "2024-06-01T10:30:00-04:00")], "2024-06-01", TZ);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ startMin: 540, endMin: 630 }); // 9:00 → 10:30
  });

  it("excludes all-day events from the time axis", () => {
    const events = [{ start: "2024-06-01", end: "2024-06-02", allDay: true }];
    expect(resolveDayEvents(events, "2024-06-01", TZ)).toHaveLength(0);
  });

  it("drops events on other days", () => {
    const r = resolveDayEvents([timed("2024-06-02T09:00:00-04:00", "2024-06-02T10:00:00-04:00")], "2024-06-01", TZ);
    expect(r).toHaveLength(0);
  });

  it("clips a midnight-crossing event into both days", () => {
    const e = timed("2024-06-01T23:00:00-04:00", "2024-06-02T01:00:00-04:00");
    const day1 = resolveDayEvents([e], "2024-06-01", TZ);
    const day2 = resolveDayEvents([e], "2024-06-02", TZ);
    expect(day1[0]).toMatchObject({ startMin: 1380, endMin: 1440 }); // 23:00 → midnight
    expect(day2[0]).toMatchObject({ startMin: 0, endMin: 60 }); // midnight → 01:00
  });

  it("spring-forward: a 9am meeting still sits at the 9am gridline (wall-clock)", () => {
    // Positioning is wall-clock, so 09:00 → 540 regardless of the skipped 2am
    // hour. The grid's 2am band is simply empty (no valid wall time lives there).
    const r = resolveDayEvents([timed("2024-03-10T09:00:00-04:00", "2024-03-10T10:00:00-04:00")], "2024-03-10", TZ);
    expect(r[0]).toMatchObject({ startMin: 540, endMin: 600 });
  });

  it("fall-back: a 9am meeting sits at the 9am gridline (wall-clock)", () => {
    const r = resolveDayEvents([timed("2024-11-03T09:00:00-05:00", "2024-11-03T10:00:00-05:00")], "2024-11-03", TZ);
    expect(r[0]).toMatchObject({ startMin: 540, endMin: 600 });
  });

  it("fall-back: both 1:30am instances resolve into the repeated-hour band", () => {
    // The America/New_York clock hits 1:30 twice on 2024-11-03 — once at -04:00,
    // once at -05:00. Both land at 90 min; layoutDay then splits them side by side.
    const first = timed("2024-11-03T01:30:00-04:00", "2024-11-03T02:00:00-04:00");
    const second = timed("2024-11-03T01:30:00-05:00", "2024-11-03T02:00:00-05:00");
    const r = resolveDayEvents([first, second], "2024-11-03", TZ);
    expect(r.map((x) => x.startMin)).toEqual([90, 90]);
  });
});

describe("resolveDayEvents + layoutDay — integration on a real day", () => {
  it("packs a morning of overlapping meetings in the user's tz", () => {
    const TZ = "America/New_York";
    const events = [
      timed("2024-06-03T09:00:00-04:00", "2024-06-03T10:00:00-04:00"), // standup
      timed("2024-06-03T09:30:00-04:00", "2024-06-03T10:30:00-04:00"), // 1:1 overlaps
      timed("2024-06-03T14:00:00-04:00", "2024-06-03T15:00:00-04:00"), // afternoon, alone
    ];
    const packed = layoutDay(resolveDayEvents(events, "2024-06-03", TZ), { minDurationMin: 15 });
    const widths = packed.map((p) => p.width).sort();
    expect(widths).toEqual([0.5, 0.5, 1]);
  });
});
