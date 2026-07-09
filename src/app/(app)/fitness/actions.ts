"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { FitnessGoal } from "@/lib/types";
import { unitToKg } from "@/lib/fitness/units";

export async function dismissFitnessOnboarding() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("profiles").select("settings").eq("id", user.id).single();
  await supabase
    .from("profiles")
    .update({ settings: { ...(data?.settings ?? {}), fitnessOnboardingDismissed: true } })
    .eq("id", user.id);
  revalidatePath("/fitness");
}

export async function addFitnessGoal(formData: FormData) {
  const exercise = String(formData.get("exercise") ?? "").trim();
  const entered = Number(formData.get("targetWeight"));
  if (!exercise || !entered || entered <= 0) return;

  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("profiles").select("settings").eq("id", user.id).single();
  // The user typed in their display unit; storage is always kg.
  const unit = data?.settings?.weightUnit ?? "kg";
  const targetWeightKg = Math.round(unitToKg(entered, unit) * 10) / 10;
  const goals: FitnessGoal[] = data?.settings?.fitnessGoals ?? [];
  const next = [...goals.filter((g) => g.exercise !== exercise), { exercise, targetWeightKg, createdAt: new Date().toISOString() }];

  await supabase
    .from("profiles")
    .update({ settings: { ...(data?.settings ?? {}), fitnessGoals: next } })
    .eq("id", user.id);
  revalidatePath("/fitness");
}

export async function removeFitnessGoal(exercise: string) {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("profiles").select("settings").eq("id", user.id).single();
  const goals: FitnessGoal[] = data?.settings?.fitnessGoals ?? [];

  await supabase
    .from("profiles")
    .update({ settings: { ...(data?.settings ?? {}), fitnessGoals: goals.filter((g) => g.exercise !== exercise) } })
    .eq("id", user.id);
  revalidatePath("/fitness");
}
