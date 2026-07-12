"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

/** Creates an empty note and jumps straight into the editor. */
export async function createNote(workspaceId?: string | null) {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("notes")
    .insert({ user_id: user.id, workspace_id: workspaceId ?? null })
    .select("id")
    .single();
  if (error || !data) throw new Error("Could not create note");
  revalidatePath("/notes");
  redirect(`/notes/${data.id}`);
}

export async function saveNote(
  id: string,
  patch: { title?: string; content?: string; pinned?: boolean; workspace_id?: string | null },
) {
  const { supabase } = await requireUser();
  await supabase
    .from("notes")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/notes");
}

export async function deleteNote(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("notes").delete().eq("id", id);
  revalidatePath("/notes");
  redirect("/notes");
}
