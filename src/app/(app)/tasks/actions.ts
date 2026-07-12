"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

export async function toggleTask(id: string, completed: boolean) {
  const { supabase } = await requireUser();
  await supabase
    .from("tasks")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function addTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const workspaceId = String(formData.get("workspace_id") ?? "").trim() || null;
  const { supabase, user } = await requireUser();
  await supabase.from("tasks").insert({ user_id: user.id, title, workspace_id: workspaceId });
  revalidatePath("/tasks");
}

export async function deleteTask(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("tasks").delete().eq("id", id);
  revalidatePath("/tasks");
}
