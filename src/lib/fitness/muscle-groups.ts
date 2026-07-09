export type MuscleGroup = "chest" | "back" | "legs" | "shoulders" | "arms" | "core" | "other";

/**
 * Keyword heuristic, not Hevy ground truth — real tagging needs Hevy's
 * exercise_templates endpoint (a separate piece of work, not built here).
 * Stated as an approximation deliberately, not hidden.
 */
const KEYWORDS: [MuscleGroup, RegExp][] = [
  ["chest", /bench|chest|pec|fly|flye|push[- ]?up/i],
  ["back", /row|pulldown|pull[- ]?up|lat|deadlift|shrug/i],
  ["legs", /squat|leg|lunge|calf|hip thrust|glute/i],
  ["shoulders", /shoulder|overhead press|ohp|lateral raise|delt/i],
  ["arms", /curl|tricep|bicep|skull ?crusher|dip/i],
  ["core", /ab|core|plank|crunch|sit[- ]?up/i],
];

export function inferMuscleGroup(exerciseName: string): MuscleGroup {
  for (const [group, pattern] of KEYWORDS) {
    if (pattern.test(exerciseName)) return group;
  }
  return "other";
}
