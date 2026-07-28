"use client";

import { useTransition } from "react";
import { FitnessGoal } from "@/lib/types";
import { WeightUnit, formatWeight } from "@/lib/fitness/units";
import { addFitnessGoal, removeFitnessGoal } from "@/app/(app)/fitness/actions";
import { Button, Input } from "@/components/ui";

interface GoalProgress extends FitnessGoal {
  currentWeightKg: number;
}

export function FitnessGoals({ goals, unit }: { goals: GoalProgress[]; unit: WeightUnit }) {
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {goals.length === 0 ? (
        <p className="text-sm text-text-dim">
          No goals yet — add one below (e.g. Bench Press → {unit === "lbs" ? "225 lbs" : "100 kg"}).
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((g) => {
            const progress = Math.min(100, Math.round((g.currentWeightKg / g.targetWeightKg) * 100));
            return (
              <li key={g.exercise} className="group">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{g.exercise}</span>
                  <span className="tabular text-xs text-text-dim">
                    {formatWeight(g.currentWeightKg, unit)} / {formatWeight(g.targetWeightKg, unit)}
                    <button
                      onClick={() => startTransition(() => removeFitnessGoal(g.exercise))}
                      className="transition-fast ml-2 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent transition-fast" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-xs text-text-dim">{progress}% of target</p>
              </li>
            );
          })}
        </ul>
      )}

      <form action={addFitnessGoal} className="flex items-end gap-2">
        <Input
          name="exercise"
          aria-label="Exercise"
          placeholder="Exercise (e.g. Bench Press)"
          autoComplete="off"
          containerClassName="min-w-0 flex-1"
        />
        <Input
          name="targetWeight"
          aria-label="Target weight"
          type="number"
          step="any"
          placeholder={`Target ${unit}`}
          containerClassName="w-28"
        />
        <Button type="submit">Add</Button>
      </form>
    </div>
  );
}
