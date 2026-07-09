import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";
import { detectPRs } from "@/lib/fitness/prs";
import { fetchSetRows } from "@/lib/fitness/refresh";
import { SetRow } from "@/lib/fitness/metrics";

/**
 * Generates a short AI summary of one workout, on demand — not on every
 * view. Caches the result in workouts.ai_summary so repeat visits are free.
 * Uses the same AI provider abstraction as everything else; no new model.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  const { data: workout } = await userCtx.supabase
    .from("workouts")
    .select("*, workout_sets(*)")
    .eq("id", id)
    .single();
  if (!workout) return NextResponse.json({ error: "Workout not found" }, { status: 404 });

  interface DbSet {
    exercise: string;
    reps: number | null;
    weight_kg: number | null;
  }
  const sets = (workout.workout_sets ?? []) as DbSet[];
  const thisWorkoutSets: SetRow[] = sets.map((s) => ({
    exercise: s.exercise,
    performed_on: workout.performed_on,
    reps: s.reps,
    weight_kg: s.weight_kg,
  }));

  const allSets = await fetchSetRows(userCtx.supabase, userCtx.user.id);
  const prior = allSets.filter((r) => r.performed_on < workout.performed_on);
  const prs = detectPRs(thisWorkoutSets, prior);

  const byExercise = new Map<string, string[]>();
  for (const s of sets) {
    if (!byExercise.has(s.exercise)) byExercise.set(s.exercise, []);
    byExercise.get(s.exercise)!.push(`${s.reps ?? "–"}x${s.weight_kg ?? "bw"}`);
  }
  const exerciseLines = [...byExercise.entries()]
    .map(([exercise, setStrs]) => `${exercise}: ${setStrs.join(", ")}`)
    .join("\n");

  const context = [
    `Workout: ${workout.title} (${workout.kind}), ${workout.performed_on}${workout.duration_min ? `, ${workout.duration_min} min` : ""}`,
    exerciseLines,
    prs.length ? `New PRs this session: ${prs.map((p) => `${p.exercise} ${p.type} ${p.value}`).join("; ")}` : "No new PRs this session.",
  ].join("\n");

  const { text } = await getProvider().chat({
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          "You are a strength coach. Write ONE short paragraph (2-3 sentences) summarizing this workout: what was trained, how it compares to recent trend, and anything notable (PRs, fatigue signs). No markdown, no bullet points, just prose.",
      },
      { role: "user", content: context },
    ],
  });

  await userCtx.supabase.from("workouts").update({ ai_summary: text.trim() }).eq("id", id);
  return NextResponse.json({ summary: text.trim() });
}
