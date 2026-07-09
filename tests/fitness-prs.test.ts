import { describe, expect, it } from "vitest";
import { detectPRs } from "@/lib/fitness/prs";
import { SetRow } from "@/lib/fitness/metrics";

describe("detectPRs", () => {
  it("detects a weight PR when no prior history exists", () => {
    const workout: SetRow[] = [{ exercise: "Bench Press", performed_on: "2026-07-06", reps: 5, weight_kg: 100 }];
    const prs = detectPRs(workout, []);
    expect(prs.some((p) => p.type === "weight" && p.previousValue === null)).toBe(true);
  });

  it("does not flag a PR when the new set is weaker than history", () => {
    const workout: SetRow[] = [{ exercise: "Bench Press", performed_on: "2026-07-06", reps: 5, weight_kg: 80 }];
    const prior: SetRow[] = [{ exercise: "Bench Press", performed_on: "2026-06-01", reps: 5, weight_kg: 100 }];
    const prs = detectPRs(workout, prior);
    expect(prs.some((p) => p.type === "weight")).toBe(false);
  });

  it("flags a weight PR when the new set beats the prior max", () => {
    const workout: SetRow[] = [{ exercise: "Bench Press", performed_on: "2026-07-06", reps: 5, weight_kg: 105 }];
    const prior: SetRow[] = [{ exercise: "Bench Press", performed_on: "2026-06-01", reps: 5, weight_kg: 100 }];
    const prs = detectPRs(workout, prior);
    const weightPR = prs.find((p) => p.type === "weight");
    expect(weightPR).toMatchObject({ value: 105, previousValue: 100 });
  });

  it("flags a session-volume PR independent of a weight PR", () => {
    const workout: SetRow[] = [
      { exercise: "Bench Press", performed_on: "2026-07-06", reps: 10, weight_kg: 80 },
      { exercise: "Bench Press", performed_on: "2026-07-06", reps: 10, weight_kg: 80 },
      { exercise: "Bench Press", performed_on: "2026-07-06", reps: 10, weight_kg: 80 },
    ]; // 2400kg volume, no single set beats prior 100kg max
    const prior: SetRow[] = [{ exercise: "Bench Press", performed_on: "2026-06-01", reps: 1, weight_kg: 100 }];
    const prs = detectPRs(workout, prior);
    expect(prs.some((p) => p.type === "weight")).toBe(false);
    expect(prs.some((p) => p.type === "volume")).toBe(true);
  });

  it("only reports PRs for exercises actually performed in this workout", () => {
    const workout: SetRow[] = [{ exercise: "Squat", performed_on: "2026-07-06", reps: 5, weight_kg: 140 }];
    const prs = detectPRs(workout, []);
    expect(prs.every((p) => p.exercise === "Squat")).toBe(true);
  });
});
