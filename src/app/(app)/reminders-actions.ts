"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

export async function completeReminder(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("reminders").update({ completed_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/");
}
