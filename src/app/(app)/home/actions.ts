"use server";

import { revalidatePath } from "next/cache";
import { getServiceClient, requireUser } from "@/lib/supabase/server";
import { fetchHousehold } from "@/lib/home/data";
import { categorizeItem } from "@/lib/home/categorize";
import { CHORE_CATEGORIES, COLLECTION_TYPES, ChoreCadence } from "@/lib/types";

/** Fail loudly, never silently — a missing migration must surface as an actionable error. */
function must(error: { message: string } | null, what: string): void {
  if (error) {
    const hint = /schema cache|does not exist/i.test(error.message)
      ? " — the home tables are missing. Run supabase/migrations/006_home.sql in the Supabase SQL editor."
      : "";
    throw new Error(`${what} failed: ${error.message}${hint}`);
  }
}

function revalidateHome() {
  revalidatePath("/home");
  revalidatePath("/home/shopping");
  revalidatePath("/home/household");
  revalidatePath("/");
}

/* ── Household lifecycle ─────────────────────────────────────────────────── */

export async function createHousehold(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Our home";
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();

  const { data: household, error } = await supabase
    .from("households")
    .insert({ name, created_by: user.id })
    .select("id")
    .single();
  must(error, "Creating the household");

  const displayName = profile?.display_name ?? "Me";
  const { error: memberError } = await supabase.from("household_members").insert({
    household_id: household!.id,
    user_id: user.id,
    name: displayName,
    initial: displayName.charAt(0).toUpperCase(),
    role: "owner",
  });
  must(memberError, "Adding you as the first member");

  // A default list so shopping works out of the box.
  await supabase.from("shopping_lists").insert({ household_id: household!.id, name: "Groceries" });
  revalidateHome();
}

export async function joinHousehold(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim().toLowerCase();
  if (!code) return;
  const { supabase, user } = await requireUser();

  // The invite code is the bearer secret here: the joiner can't see the
  // household through RLS until they're a member, so the lookup runs with
  // the service client, server-side only.
  const service = getServiceClient();
  const { data: household } = await service
    .from("households")
    .select("id")
    .eq("invite_code", code)
    .maybeSingle();
  if (!household) throw new Error("No household found for that invite code.");

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const displayName = profile?.display_name ?? "Me";
  const { error } = await supabase.from("household_members").insert({
    household_id: household.id,
    user_id: user.id,
    name: displayName,
    initial: displayName.charAt(0).toUpperCase(),
    role: "member",
  });
  must(error, "Joining the household");
  revalidateHome();
}

/* ── Members ─────────────────────────────────────────────────────────────── */

export async function addMember(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#d97706");
  if (!name) return;
  const { supabase, user } = await requireUser();
  const base = await fetchHousehold(supabase, user.id);
  if (!base) throw new Error("No household yet.");

  const { error } = await supabase.from("household_members").insert({
    household_id: base.household.id,
    name,
    initial: name.charAt(0).toUpperCase(),
    color,
  });
  must(error, "Adding the member");
  revalidateHome();
}

export async function removeMember(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("household_members").delete().eq("id", id);
  must(error, "Removing the member");
  revalidateHome();
}

/* ── Collection schedules ────────────────────────────────────────────────── */

export async function upsertCollectionSchedule(formData: FormData) {
  const type = String(formData.get("type") ?? "");
  const dayOfWeek = Number(formData.get("day_of_week"));
  const frequency = String(formData.get("frequency") ?? "weekly");
  if (!(COLLECTION_TYPES as readonly string[]).includes(type) || Number.isNaN(dayOfWeek)) return;

  const { supabase, user } = await requireUser();
  const base = await fetchHousehold(supabase, user.id);
  if (!base) throw new Error("No household yet.");

  const { error } = await supabase.from("collection_schedules").upsert(
    {
      household_id: base.household.id,
      type,
      day_of_week: dayOfWeek,
      frequency,
      anchor_date: new Date().toISOString().slice(0, 10),
    },
    { onConflict: "household_id,type" },
  );
  must(error, "Saving the collection schedule");
  revalidateHome();
}

export async function deleteCollectionSchedule(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("collection_schedules").delete().eq("id", id);
  must(error, "Removing the schedule");
  revalidateHome();
}

/* ── Chores ──────────────────────────────────────────────────────────────── */

export async function addChore(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const cadence = String(formData.get("cadence") ?? "weekly") as ChoreCadence;
  const category = String(formData.get("category") ?? "other");
  const assignedMemberId = String(formData.get("assigned_member_id") ?? "");
  if (!title) return;
  if (!(CHORE_CATEGORIES as readonly string[]).includes(category)) return;

  const { supabase, user } = await requireUser();
  const base = await fetchHousehold(supabase, user.id);
  if (!base) throw new Error("No household yet.");

  const { error } = await supabase.from("chores").insert({
    household_id: base.household.id,
    title,
    cadence,
    category,
    assigned_member_id: assignedMemberId || null,
    rotate_assignment: formData.get("rotate") === "on",
  });
  must(error, "Adding the chore");
  revalidateHome();
}

export async function completeChore(choreId: string, memberId: string | null) {
  const { supabase, user } = await requireUser();
  const base = await fetchHousehold(supabase, user.id);
  if (!base) throw new Error("No household yet.");

  const { error } = await supabase.from("chore_completions").insert({
    chore_id: choreId,
    household_id: base.household.id,
    member_id: memberId ?? base.me?.id ?? null,
    completed_on: new Date().toISOString().slice(0, 10),
  });
  must(error, "Completing the chore");
  revalidateHome();
}

export async function archiveChore(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("chores").update({ archived_at: new Date().toISOString() }).eq("id", id);
  must(error, "Removing the chore");
  revalidateHome();
}

/* ── Shopping ────────────────────────────────────────────────────────────── */

export async function addShoppingList(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { supabase, user } = await requireUser();
  const base = await fetchHousehold(supabase, user.id);
  if (!base) throw new Error("No household yet.");
  const { error } = await supabase.from("shopping_lists").insert({ household_id: base.household.id, name });
  must(error, "Creating the list");
  revalidateHome();
}

export async function addShoppingItem(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const listId = String(formData.get("list_id") ?? "");
  const quantity = String(formData.get("quantity") ?? "").trim();
  if (!name || !listId) return;

  const { supabase, user } = await requireUser();
  const base = await fetchHousehold(supabase, user.id);
  if (!base) throw new Error("No household yet.");

  const { error } = await supabase.from("shopping_items").insert({
    list_id: listId,
    household_id: base.household.id,
    name,
    quantity: quantity || null,
    category: categorizeItem(name), // deterministic keyword fallback on the manual path
    added_by_member_id: base.me?.id ?? null,
  });
  must(error, "Adding the item");
  revalidateHome();
}

export async function toggleShoppingItem(id: string, completed: boolean) {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("shopping_items")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id);
  must(error, "Updating the item");
  revalidateHome();
}

export async function deleteShoppingItem(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("shopping_items").delete().eq("id", id);
  must(error, "Removing the item");
  revalidateHome();
}

export async function clearCompletedItems(listId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("shopping_items").delete().eq("list_id", listId).not("completed_at", "is", null);
  must(error, "Clearing completed items");
  revalidateHome();
}
