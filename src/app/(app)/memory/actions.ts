"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";
import { saveMemory, updateMemory } from "@/lib/memory";
import { MemoryKind } from "@/lib/types";

export async function deleteMemory(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("memories").delete().eq("id", id);
  revalidatePath("/memory");
}

export async function editMemory(id: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) return;
  const { supabase } = await requireUser();
  await updateMemory(supabase, getProvider(), id, trimmed);
  revalidatePath("/memory");
}

export async function addMemory(formData: FormData) {
  const kind = String(formData.get("kind") ?? "preference") as MemoryKind;
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  const { supabase, user } = await requireUser();
  await saveMemory(supabase, getProvider(), user.id, kind, content, 3, 5);
  revalidatePath("/memory");
}
