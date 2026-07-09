import { SupabaseClient } from "@supabase/supabase-js";
import {
  Chore, ChoreCompletion, CollectionSchedule, Household, HouseholdMember,
  ShoppingItem, ShoppingList,
} from "@/lib/types";

export interface HomeData {
  household: Household;
  members: HouseholdMember[];
  /** The member row linked to the signed-in user (assignment default, activity attribution). */
  me: HouseholdMember | null;
  chores: Chore[];
  completions: ChoreCompletion[]; // trailing 90 days — enough for analytics + staleness
  collections: CollectionSchedule[];
  lists: ShoppingList[];
  items: ShoppingItem[];
}

/** The signed-in user's household, or null when they haven't created/joined one. */
export async function fetchHousehold(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ household: Household; members: HouseholdMember[]; me: HouseholdMember | null } | null> {
  const { data: myMember } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!myMember) return null;

  const [{ data: household }, { data: members }] = await Promise.all([
    supabase.from("households").select("*").eq("id", myMember.household_id).single(),
    supabase.from("household_members").select("*").eq("household_id", myMember.household_id).order("created_at"),
  ]);
  if (!household) return null;

  const memberRows = (members ?? []) as HouseholdMember[];
  return {
    household: household as Household,
    members: memberRows,
    me: memberRows.find((m) => m.user_id === userId) ?? null,
  };
}

/** Everything the Home surfaces derive from — one fetch, shared by pages, tools, and insights. */
export async function fetchHomeData(supabase: SupabaseClient, userId: string): Promise<HomeData | null> {
  const base = await fetchHousehold(supabase, userId);
  if (!base) return null;
  const hid = base.household.id;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: chores }, { data: completions }, { data: collections }, { data: lists }, { data: items }] =
    await Promise.all([
      supabase.from("chores").select("*").eq("household_id", hid).is("archived_at", null).order("created_at"),
      supabase
        .from("chore_completions")
        .select("id, chore_id, member_id, completed_on")
        .eq("household_id", hid)
        .gte("completed_on", ninetyDaysAgo)
        .order("completed_on", { ascending: false }),
      supabase.from("collection_schedules").select("*").eq("household_id", hid),
      supabase.from("shopping_lists").select("id, name, archived_at").eq("household_id", hid).is("archived_at", null).order("created_at"),
      supabase
        .from("shopping_items")
        .select("*")
        .eq("household_id", hid)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

  return {
    ...base,
    chores: (chores ?? []) as Chore[],
    completions: (completions ?? []) as ChoreCompletion[],
    collections: (collections ?? []) as CollectionSchedule[],
    lists: (lists ?? []) as ShoppingList[],
    items: (items ?? []) as ShoppingItem[],
  };
}

/** Fuzzy member lookup for AI references ("Sarah") — mirrors complete_task's title matching. */
export function resolveMember(members: HouseholdMember[], nameQuery: string): HouseholdMember | "ambiguous" | null {
  const q = nameQuery.trim().toLowerCase();
  if (!q) return null;
  const matches = members.filter((m) => m.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) return "ambiguous";
  return null;
}
