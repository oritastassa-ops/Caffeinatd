import { describe, expect, it } from "vitest";
import { computeConsistency } from "@/lib/fitness/consistency";

const NOW = new Date("2026-07-06T12:00:00Z"); // a Monday

describe("computeConsistency", () => {
  it("computes 100% when hitting the weekly target every trailing week", () => {
    const dates: string[] = [];
    for (let w = 0; w < 12; w++) {
      const d = new Date(NOW.getTime() - w * 7 * 86_400_000);
      dates.push(d.toISOString().slice(0, 10));
      dates.push(new Date(d.getTime() - 2 * 86_400_000).toISOString().slice(0, 10));
      dates.push(new Date(d.getTime() - 4 * 86_400_000).toISOString().slice(0, 10));
    }
    const result = computeConsistency(dates, 3, NOW);
    expect(result.consistencyPercent).toBe(100);
    expect(result.avgPerWeek).toBe(3);
  });

  it("computes a current streak of consecutive weeks with at least one workout", () => {
    const dates = [
      NOW.toISOString().slice(0, 10),
      new Date(NOW.getTime() - 7 * 86_400_000).toISOString().slice(0, 10),
      new Date(NOW.getTime() - 14 * 86_400_000).toISOString().slice(0, 10),
    ];
    const result = computeConsistency(dates, 1, NOW);
    expect(result.currentStreakWeeks).toBe(3);
  });

  it("breaks the streak on a missed week", () => {
    const dates = [
      NOW.toISOString().slice(0, 10),
      new Date(NOW.getTime() - 21 * 86_400_000).toISOString().slice(0, 10), // 3 weeks ago — gap
    ];
    const result = computeConsistency(dates, 1, NOW);
    expect(result.currentStreakWeeks).toBe(1);
  });

  it("returns zero consistency with no workouts logged", () => {
    const result = computeConsistency([], 3, NOW);
    expect(result.consistencyPercent).toBe(0);
    expect(result.currentStreakWeeks).toBe(0);
    expect(result.longestStreakWeeks).toBe(0);
  });
});
