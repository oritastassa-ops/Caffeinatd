import { describe, expect, it } from "vitest";
import {
  computeChoreStats, daysSinceCategoryCompletion, isDueOn, nextAssignee, overdueDays,
} from "@/lib/home/schedule";
import { chore, completion, member } from "./home-fixtures";

describe("chore due logic", () => {
  it("daily: due unless completed that day", () => {
    const c = chore({ cadence: "daily", anchor_date: "2026-07-01" });
    expect(isDueOn(c, "2026-07-06", [])).toBe(true);
    expect(isDueOn(c, "2026-07-06", [completion({ completed_on: "2026-07-06" })])).toBe(false);
    expect(isDueOn(c, "2026-07-06", [completion({ completed_on: "2026-07-05" })])).toBe(true);
  });

  it("daily: not due before its anchor date", () => {
    const c = chore({ cadence: "daily", anchor_date: "2026-08-01" });
    expect(isDueOn(c, "2026-07-06", [])).toBe(false);
  });

  it("weekly: due on and after the occurrence day until completed", () => {
    // Anchored Monday 2026-06-01 → occurrences every Monday.
    const c = chore({ cadence: "weekly", anchor_date: "2026-06-01" });
    // Monday 2026-07-06 is an occurrence; nothing completed since → due.
    expect(isDueOn(c, "2026-07-06", [completion({ completed_on: "2026-06-29" })])).toBe(true);
    // Completed on the day → not due.
    expect(isDueOn(c, "2026-07-06", [completion({ completed_on: "2026-07-06" })])).toBe(false);
    // Still due two days later if the Monday occurrence was never covered.
    expect(isDueOn(c, "2026-07-08", [completion({ completed_on: "2026-06-29" })])).toBe(true);
    // Completed Tuesday covers Monday's occurrence through the rest of the week.
    expect(isDueOn(c, "2026-07-08", [completion({ completed_on: "2026-07-07" })])).toBe(false);
  });

  it("weekly: the anchor day itself is an occurrence", () => {
    const c = chore({ cadence: "weekly", anchor_date: "2026-07-06" });
    expect(isDueOn(c, "2026-07-06", [])).toBe(true);
  });

  it("one_time: due from its date until completed, then never again", () => {
    const c = chore({ cadence: "one_time", anchor_date: "2026-07-01" });
    expect(isDueOn(c, "2026-06-30", [])).toBe(false);
    expect(isDueOn(c, "2026-07-06", [])).toBe(true);
    expect(isDueOn(c, "2026-07-06", [completion({ completed_on: "2026-07-03" })])).toBe(false);
  });

  it("archived chores are never due", () => {
    const c = chore({ cadence: "daily", archived_at: "2026-07-01T00:00:00Z" });
    expect(isDueOn(c, "2026-07-06", [])).toBe(false);
  });

  it("overdueDays counts from the uncovered occurrence; daily is never 'overdue'", () => {
    const weekly = chore({ cadence: "weekly", anchor_date: "2026-06-01" });
    // Occurrence Monday 2026-07-06, today Friday 2026-07-10 → 4 days overdue.
    expect(overdueDays(weekly, "2026-07-10", [])).toBe(4);
    const daily = chore({ cadence: "daily", anchor_date: "2026-06-01" });
    expect(overdueDays(daily, "2026-07-10", [])).toBe(0);
  });
});

describe("rotation", () => {
  const members = [member({ id: "m1", name: "Alex" }), member({ id: "m2", name: "Sarah" })];

  it("returns the explicit assignee when rotation is off", () => {
    const c = chore({ assigned_member_id: "m2" });
    expect(nextAssignee(c, members, [])?.id).toBe("m2");
  });

  it("alternates to the member after the last completer", () => {
    const c = chore({ rotate_assignment: true });
    const done = [completion({ member_id: "m1", completed_on: "2026-07-01" })];
    expect(nextAssignee(c, members, done)?.id).toBe("m2");
  });

  it("wraps around the member list", () => {
    const c = chore({ rotate_assignment: true });
    const done = [completion({ member_id: "m2", completed_on: "2026-07-01" })];
    expect(nextAssignee(c, members, done)?.id).toBe("m1");
  });

  it("uses the newest completion when history has several", () => {
    const c = chore({ rotate_assignment: true });
    const done = [
      completion({ id: "a", member_id: "m1", completed_on: "2026-06-20" }),
      completion({ id: "b", member_id: "m2", completed_on: "2026-07-01" }),
    ];
    expect(nextAssignee(c, members, done)?.id).toBe("m1");
  });
});

describe("household analytics", () => {
  it("reports days since a category was last completed", () => {
    const chores = [chore({ id: "k1", category: "kitchen" })];
    const done = [completion({ chore_id: "k1", completed_on: "2026-06-27" })];
    expect(daysSinceCategoryCompletion("kitchen", chores, done, "2026-07-06")).toBe(9);
    expect(daysSinceCategoryCompletion("bathroom", chores, done, "2026-07-06")).toBeNull();
  });

  it("computes weekly count, 30-day completion rate, and most active member", () => {
    const chores = [chore({ id: "w1", cadence: "weekly", anchor_date: "2026-06-01" })];
    // ~5 weekly occurrences in trailing 30 days window; 4 completions.
    const done = [
      completion({ id: "1", chore_id: "w1", member_id: "m1", completed_on: "2026-06-15" }),
      completion({ id: "2", chore_id: "w1", member_id: "m2", completed_on: "2026-06-22" }),
      completion({ id: "3", chore_id: "w1", member_id: "m1", completed_on: "2026-06-29" }),
      completion({ id: "4", chore_id: "w1", member_id: "m1", completed_on: "2026-07-06" }),
    ];
    const members = [member({ id: "m1" }), member({ id: "m2", name: "Sarah" })];
    const stats = computeChoreStats(chores, done, members, "2026-07-06");
    expect(stats.completedThisWeek).toBe(1);
    expect(stats.completionRatePercent).toBeGreaterThanOrEqual(80);
    expect(stats.mostActiveMemberId).toBe("m1");
  });
});
