import { describe, expect, it } from "vitest";
import { computeMuscleRecovery } from "@/lib/fitness/recovery";
import { SetRow } from "@/lib/fitness/metrics";

const NOW = new Date("2026-07-06T12:00:00Z");

describe("computeMuscleRecovery", () => {
  it("infers group from exercise name and reports fatigued right after a heavy session", () => {
    const rows: SetRow[] = [
      { exercise: "Bench Press", performed_on: "2026-07-06", reps: 5, weight_kg: 100 },
    ];
    const result = computeMuscleRecovery(rows, NOW);
    const chest = result.find((r) => r.group === "chest")!;
    expect(chest).toBeDefined();
    expect(chest.percent).toBeLessThan(50);
    expect(chest.label).toBe("Fatigued");
    expect(chest.detail).toContain("chest");
  });

  it("reports well recovered after several days with a light prior session", () => {
    const rows: SetRow[] = [
      { exercise: "Squat", performed_on: "2026-07-01", reps: 5, weight_kg: 60 },
    ];
    const result = computeMuscleRecovery(rows, NOW);
    const legs = result.find((r) => r.group === "legs")!;
    expect(legs.percent).toBe(100);
    expect(legs.label).toBe("Ready");
  });

  it("scales recovery time with relative session volume", () => {
    const heavyThenLight: SetRow[] = [
      { exercise: "Row", performed_on: "2026-06-01", reps: 5, weight_kg: 50 },
      { exercise: "Row", performed_on: "2026-06-08", reps: 5, weight_kg: 50 },
      { exercise: "Row", performed_on: "2026-07-05", reps: 20, weight_kg: 100 }, // much heavier than average
    ];
    const result = computeMuscleRecovery(heavyThenLight, NOW);
    const back = result.find((r) => r.group === "back")!;
    // A session far above the rolling average needs closer to the max recovery window.
    expect(back.percent).toBeLessThan(60);
  });

  it("excludes exercises that map to no recognized muscle group", () => {
    const rows: SetRow[] = [{ exercise: "Farmers Carry", performed_on: "2026-07-06", reps: 1, weight_kg: 40 }];
    const result = computeMuscleRecovery(rows, NOW);
    expect(result).toHaveLength(0);
  });

  it("sorts most-fatigued first", () => {
    const rows: SetRow[] = [
      { exercise: "Bench Press", performed_on: "2026-07-06", reps: 5, weight_kg: 100 }, // today, fatigued
      { exercise: "Squat", performed_on: "2026-07-01", reps: 5, weight_kg: 60 }, // days ago, ready
    ];
    const result = computeMuscleRecovery(rows, NOW);
    expect(result[0]!.group).toBe("chest");
  });
});
