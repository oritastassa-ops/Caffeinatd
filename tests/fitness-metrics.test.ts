import { describe, expect, it } from "vitest";
import { computeExerciseMetrics, computeProgressionTrend, estimate1RM, SetRow } from "@/lib/fitness/metrics";

const NOW = new Date("2026-07-06T12:00:00Z");

describe("estimate1RM (Epley)", () => {
  it("returns the weight itself for a 1-rep set", () => {
    expect(estimate1RM(100, 1)).toBe(100);
  });
  it("estimates higher for more reps at the same weight", () => {
    expect(estimate1RM(100, 8)).toBeGreaterThan(estimate1RM(100, 5));
  });
  it("is 0 for invalid input", () => {
    expect(estimate1RM(0, 5)).toBe(0);
    expect(estimate1RM(100, 0)).toBe(0);
  });
});

describe("computeExerciseMetrics", () => {
  const rows: SetRow[] = [
    { exercise: "Bench Press", performed_on: "2026-07-01", reps: 5, weight_kg: 100 },
    { exercise: "Bench Press", performed_on: "2026-06-01", reps: 5, weight_kg: 90 },
    { exercise: "Squat", performed_on: "2026-07-05", reps: 5, weight_kg: 140 },
  ];

  it("groups by exercise and computes max weight / total volume", () => {
    const metrics = computeExerciseMetrics(rows, NOW);
    const bench = metrics.find((m) => m.exercise === "Bench Press")!;
    expect(bench.maxWeightKg).toBe(100);
    expect(bench.totalVolume).toBe(5 * 100 + 5 * 90);
  });

  it("scopes volume7d/volume30d to the trailing window", () => {
    const metrics = computeExerciseMetrics(rows, NOW);
    const bench = metrics.find((m) => m.exercise === "Bench Press")!;
    // 2026-07-01 is 5 days before NOW (within 7d/30d); 2026-06-01 is 35 days before (outside both).
    expect(bench.volume7d).toBe(500);
    expect(bench.volume30d).toBe(500);
    expect(bench.totalVolume).toBe(950);
  });

  it("tracks the most recent performed_on per exercise", () => {
    const metrics = computeExerciseMetrics(rows, NOW);
    const squat = metrics.find((m) => m.exercise === "Squat")!;
    expect(squat.lastPerformedOn).toBe("2026-07-05");
  });
});

describe("computeProgressionTrend", () => {
  const rows: SetRow[] = [
    { exercise: "Bench Press", performed_on: "2026-07-01", reps: 5, weight_kg: 100 }, // within last 30d
    { exercise: "Bench Press", performed_on: "2026-05-20", reps: 5, weight_kg: 90 }, // 30-60d ago
  ];

  it("computes a positive change percent when current beats previous", () => {
    const trend = computeProgressionTrend(rows, "Bench Press", NOW);
    expect(trend.current1RM).not.toBeNull();
    expect(trend.previous1RM).not.toBeNull();
    expect(trend.changePercent).toBeGreaterThan(0);
  });

  it("returns nulls when there's no data in a window", () => {
    const trend = computeProgressionTrend(rows, "Squat", NOW);
    expect(trend.current1RM).toBeNull();
    expect(trend.changePercent).toBeNull();
  });
});
