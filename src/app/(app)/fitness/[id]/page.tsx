import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { Card, CardTitle, PageHeader, Stat } from "@/components/ui";
import { WorkoutAISummary } from "@/components/workout-ai-summary";
import { loadProfile } from "@/lib/pipeline/run";
import { fetchSetRows } from "@/lib/fitness/refresh";
import { detectPRs } from "@/lib/fitness/prs";
import { SetRow } from "@/lib/fitness/metrics";
import { formatVolume, formatWeight, weightValue } from "@/lib/fitness/units";

export const dynamic = "force-dynamic";

interface DbSet {
  id: string;
  exercise: string;
  set_no: number;
  reps: number | null;
  weight_kg: number | null;
}

export default async function WorkoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const unit = profile.settings.weightUnit ?? "kg";

  const { data: workout } = await supabase.from("workouts").select("*, workout_sets(*)").eq("id", id).single();
  if (!workout) notFound();

  const sets = (workout.workout_sets ?? []) as DbSet[];
  const byExercise = new Map<string, DbSet[]>();
  for (const s of sets) {
    if (!byExercise.has(s.exercise)) byExercise.set(s.exercise, []);
    byExercise.get(s.exercise)!.push(s);
  }

  const allSets = await fetchSetRows(supabase, user.id);
  const priorSets = allSets.filter((r) => r.performed_on < workout.performed_on);
  const thisWorkoutSets: SetRow[] = sets.map((s) => ({
    exercise: s.exercise,
    performed_on: workout.performed_on,
    reps: s.reps,
    weight_kg: s.weight_kg,
  }));
  const prs = detectPRs(thisWorkoutSets, priorSets);

  const totalVolume = sets.reduce((sum, s) => sum + (s.reps ?? 0) * (s.weight_kg ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={workout.title}
        back={{ href: "/fitness", label: "Fitness" }}
        action={<span className="tabular text-sm text-text-dim">{workout.performed_on}</span>}
      />

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Duration" value={workout.duration_min ? `${workout.duration_min}m` : "—"} />
        <Stat label="Volume" value={formatVolume(totalVolume, unit)} />
        <Stat label="Exercises" value={byExercise.size} />
      </div>

      {prs.length > 0 && (
        <Card className="border-accent/30 bg-accent-soft/40">
          <CardTitle>Achievements</CardTitle>
          <ul className="flex flex-col gap-1.5 text-sm">
            {prs.map((pr, i) => (
              <li key={i}>
                <span className="font-medium">New {labelForPRType(pr.type)}:</span> {pr.exercise} —{" "}
                {formatWeight(pr.value, unit)}
                {pr.type === "estimated_1rm" ? " est. 1RM" : pr.type === "volume" ? " volume" : ""}
                {pr.previousValue !== null && (
                  <span className="text-text-dim"> (+{formatWeight(pr.value - pr.previousValue, unit)})</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>AI summary</CardTitle>
        <WorkoutAISummary workoutId={workout.id} initialSummary={workout.ai_summary} />
      </Card>

      <Card>
        <CardTitle>Exercises</CardTitle>
        <div className="flex flex-col gap-4">
          {[...byExercise.entries()].map(([exercise, exSets]) => {
            const best = exSets.reduce((b, s) => ((s.weight_kg ?? 0) > (b.weight_kg ?? 0) ? s : b), exSets[0]!);
            const volume = exSets.reduce((sum, s) => sum + (s.reps ?? 0) * (s.weight_kg ?? 0), 0);
            const priorBest = priorSets
              .filter((r) => r.exercise === exercise && r.weight_kg)
              .reduce<number | null>((max, r) => (max === null || r.weight_kg! > max ? r.weight_kg! : max), null);

            return (
              <div key={exercise} className="border-b pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">{exercise}</p>
                  <p className="tabular text-xs text-text-dim">
                    {exSets.length} sets · {formatVolume(volume, unit)} volume
                  </p>
                </div>
                <div className="tabular mt-2 flex flex-wrap gap-1.5">
                  {exSets.map((s) => (
                    <span
                      key={s.id}
                      className={
                        s === best
                          ? "rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
                          : "rounded-md bg-surface-2 px-2 py-0.5 text-xs"
                      }
                    >
                      {s.reps ?? "–"}×{weightValue(s.weight_kg, unit)}
                    </span>
                  ))}
                </div>
                {priorBest !== null && (
                  <p className="mt-1 text-xs text-text-dim">
                    Previous best: {formatWeight(priorBest, unit)}
                    {best.weight_kg !== null && (
                      <span className={best.weight_kg > priorBest ? "text-good" : ""}>
                        {" "}
                        ({best.weight_kg > priorBest ? "+" : ""}
                        {formatWeight(best.weight_kg - priorBest, unit)})
                      </span>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function labelForPRType(type: string): string {
  if (type === "weight") return "PR";
  if (type === "estimated_1rm") return "estimated 1RM";
  return "volume record";
}
