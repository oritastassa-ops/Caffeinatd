import { describe, expect, it } from "vitest";
import { mapHevyWorkout } from "@/lib/integrations/hevy/mapper";
import { HevyWorkout } from "@/lib/integrations/hevy/client";

function workout(overrides: Partial<HevyWorkout>): HevyWorkout {
  return {
    id: "w1",
    title: "Push Day",
    routine_id: null,
    description: "Felt strong",
    start_time: "2026-07-06T12:00:00Z",
    end_time: "2026-07-06T13:00:00Z",
    updated_at: "2026-07-06T13:00:00Z",
    created_at: "2026-07-06T12:00:00Z",
    exercises: [],
    ...overrides,
  };
}

describe("mapHevyWorkout", () => {
  it("maps title, notes, and date", () => {
    const m = mapHevyWorkout(workout({}));
    expect(m.title).toBe("Push Day");
    expect(m.notes).toBe("Felt strong");
    expect(m.performed_on).toBe("2026-07-06");
    expect(m.provider_workout_id).toBe("w1");
  });

  it("computes duration in minutes from start/end", () => {
    const m = mapHevyWorkout(workout({ start_time: "2026-07-06T12:00:00Z", end_time: "2026-07-06T13:15:00Z" }));
    expect(m.duration_min).toBe(75);
  });

  it("infers strength when any set has weight", () => {
    const m = mapHevyWorkout(
      workout({
        exercises: [
          {
            index: 0,
            title: "Bench Press",
            notes: null,
            exercise_template_id: "x",
            supersets_id: null,
            sets: [{ index: 0, type: "normal", weight_kg: 60, reps: 8, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null }],
          },
        ],
      }),
    );
    expect(m.kind).toBe("strength");
    expect(m.sets).toHaveLength(1);
    expect(m.sets[0]).toMatchObject({ exercise: "Bench Press", set_no: 1, weight_kg: 60, reps: 8 });
  });

  it("infers cardio when sets have distance/duration but no weight", () => {
    const m = mapHevyWorkout(
      workout({
        exercises: [
          {
            index: 0,
            title: "Treadmill Run",
            notes: null,
            exercise_template_id: "x",
            supersets_id: null,
            sets: [{ index: 0, type: "normal", weight_kg: null, reps: null, distance_meters: 5000, duration_seconds: 1800, rpe: null, custom_metric: null }],
          },
        ],
      }),
    );
    expect(m.kind).toBe("cardio");
    expect(m.distance_km).toBe(5);
  });

  it("falls back to 'other' with no weight or cardio signal", () => {
    const m = mapHevyWorkout(
      workout({
        exercises: [
          {
            index: 0,
            title: "Stretching",
            notes: null,
            exercise_template_id: "x",
            supersets_id: null,
            sets: [{ index: 0, type: "normal", weight_kg: null, reps: null, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null }],
          },
        ],
      }),
    );
    expect(m.kind).toBe("other");
    expect(m.distance_km).toBeNull();
  });

  it("carries exercise notes onto each of its sets, and preserves the raw payload", () => {
    const raw = workout({
      exercises: [
        {
          index: 0,
          title: "Squat",
          notes: "Focused on depth",
          exercise_template_id: "x",
          supersets_id: null,
          sets: [
            { index: 0, type: "warmup", weight_kg: 40, reps: 10, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null },
            { index: 1, type: "normal", weight_kg: 100, reps: 5, distance_meters: null, duration_seconds: null, rpe: 8.5, custom_metric: null },
          ],
        },
      ],
    });
    const m = mapHevyWorkout(raw);
    expect(m.sets.every((s) => s.notes === "Focused on depth")).toBe(true);
    expect(m.sets[1]?.rpe).toBe(8.5);
    expect(m.sets[1]?.set_type).toBe("normal");
    expect(m.raw).toEqual(raw);
  });
});
