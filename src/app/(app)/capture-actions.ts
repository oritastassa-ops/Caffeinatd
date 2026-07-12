"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

/** Quick Capture: one line into the inbox, triaged later. */
export async function addCapture(content: string, workspaceId?: string | null) {
  const text = content.trim();
  if (!text) return;
  const { supabase, user } = await requireUser();
  await supabase
    .from("captures")
    .insert({ user_id: user.id, content: text.slice(0, 500), workspace_id: workspaceId ?? null });
  revalidatePath("/");
}

export async function resolveCapture(id: string, status: "processed" | "dismissed") {
  const { supabase } = await requireUser();
  await supabase
    .from("captures")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/");
}

/** Promote a capture to a real task, marking it processed in the same breath. */
export async function captureToTask(id: string, content: string) {
  const { supabase, user } = await requireUser();
  await supabase.from("tasks").insert({ user_id: user.id, title: content.slice(0, 200) });
  await supabase
    .from("captures")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/");
  revalidatePath("/tasks");
}
