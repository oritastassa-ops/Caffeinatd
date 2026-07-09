import { describe, expect, it } from "vitest";
import { getToolDefs, toolSchemas } from "@/lib/pipeline/tools";

describe("tool contract", () => {
  it("produces a JSON-Schema definition for every tool", () => {
    const defs = getToolDefs();
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(toolSchemas).sort());
    for (const def of defs) {
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.parameters).toHaveProperty("type", "object");
    }
  });

  it("strips keys Gemini rejects", () => {
    for (const def of getToolDefs()) {
      const json = JSON.stringify(def.parameters);
      expect(json).not.toContain("$schema");
      expect(json).not.toContain("additionalProperties");
      expect(json).not.toContain("exclusiveMinimum");
      expect(json).not.toContain("exclusiveMaximum");
    }
  });

  it("validates create_task args and rejects bad priority", () => {
    expect(toolSchemas.create_task.safeParse({ title: "Call mom" }).success).toBe(true);
    expect(toolSchemas.create_task.safeParse({ title: "x", priority: 9 }).success).toBe(false);
    expect(toolSchemas.create_task.safeParse({}).success).toBe(false);
  });

  it("requires macro estimates on log_meal", () => {
    expect(
      toolSchemas.log_meal.safeParse({
        description: "chicken and rice",
        calories: 520,
        protein_g: 42,
        carbs_g: 55,
        fat_g: 12,
      }).success,
    ).toBe(true);
    expect(toolSchemas.log_meal.safeParse({ description: "chicken and rice" }).success).toBe(false);
  });

  it("accepts nested workout sets", () => {
    const parsed = toolSchemas.log_workout.safeParse({
      title: "Push day",
      kind: "strength",
      sets: [{ exercise: "Bench", reps: 8, weight_kg: 60 }],
    });
    expect(parsed.success).toBe(true);
  });
});
