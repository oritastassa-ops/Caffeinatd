"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";

export async function updateProfile(formData: FormData) {
  const { supabase, user } = await requireUser();

  const num = (name: string) => {
    const v = String(formData.get(name) ?? "").trim();
    return v ? Number(v) : undefined;
  };
  const str = (name: string) => {
    const v = String(formData.get(name) ?? "").trim();
    return v || undefined;
  };

  const { data: existing } = await supabase.from("profiles").select("settings").eq("id", user.id).single();

  const settings = {
    ...(existing?.settings ?? {}),
    calorieGoal: num("calorieGoal"),
    proteinGoal: num("proteinGoal"),
    sleepHours: num("sleepHours"),
    windDownMinutes: num("windDownMinutes"),
    weeklyWorkoutTarget: num("weeklyWorkoutTarget"),
    communicationStyle: str("communicationStyle") ?? existing?.settings?.communicationStyle,
    weightUnit: str("weightUnit") ?? existing?.settings?.weightUnit,
    trainingProgramId: str("trainingProgramId") ?? existing?.settings?.trainingProgramId,
  };

  await supabase
    .from("profiles")
    .update({
      display_name: String(formData.get("display_name") ?? "").trim() || "there",
      timezone: String(formData.get("timezone") ?? "UTC"),
      settings: Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)),
    })
    .eq("id", user.id);

  revalidatePath("/settings");
  revalidatePath("/");
}

export async function disconnectCalendar() {
  const { supabase, user } = await requireUser();
  await supabase.from("google_tokens").delete().eq("user_id", user.id);
  revalidatePath("/settings");
}

export async function signOut() {
  const { supabase } = await requireUser();
  await supabase.auth.signOut();
  redirect("/login");
}
