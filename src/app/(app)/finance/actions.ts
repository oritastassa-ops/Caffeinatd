"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { writeSnapshot } from "@/lib/finance/data";
import { ASSET_KINDS, AccountKind, LIABILITY_KINDS } from "@/lib/types";

function sideForKind(kind: AccountKind): "asset" | "liability" {
  return (ASSET_KINDS as readonly string[]).includes(kind) ? "asset" : "liability";
}

/** Fail loudly, never silently — a missing migration (relation does not exist)
 *  must surface as an actionable error, not a form that "works" and shows nothing. */
function must(error: { message: string } | null, what: string): void {
  if (error) {
    const hint = /schema cache|does not exist/i.test(error.message)
      ? " — the finance tables are missing. Run supabase/migrations/005_finance.sql in the Supabase SQL editor."
      : "";
    throw new Error(`${what} failed: ${error.message}${hint}`);
  }
}

export async function addAccount(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "checking") as AccountKind;
  const balance = Number(formData.get("balance"));
  const expectedReturn = String(formData.get("expected_return_pct") ?? "").trim();
  if (!name || Number.isNaN(balance) || balance < 0) return;
  if (![...ASSET_KINDS, ...LIABILITY_KINDS].includes(kind)) return;

  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("finance_accounts").insert({
    user_id: user.id,
    name,
    kind,
    side: sideForKind(kind),
    balance,
    expected_return_pct: expectedReturn ? Number(expectedReturn) : null,
  });
  must(error, "Adding the account");
  await writeSnapshot(supabase, user.id); // balance changes update net-worth history immediately
  revalidatePath("/finance");
  revalidatePath("/finance/accounts");
}

export async function updateAccountBalance(id: string, balance: number) {
  if (Number.isNaN(balance) || balance < 0) return;
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("finance_accounts")
    .update({ balance, updated_at: new Date().toISOString() })
    .eq("id", id);
  must(error, "Updating the balance");
  await writeSnapshot(supabase, user.id);
  revalidatePath("/finance");
  revalidatePath("/finance/accounts");
}

export async function archiveAccount(id: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("finance_accounts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  must(error, "Archiving the account");
  await writeSnapshot(supabase, user.id);
  revalidatePath("/finance");
  revalidatePath("/finance/accounts");
}

export async function addTransaction(formData: FormData) {
  const direction = String(formData.get("direction")) === "income" ? "income" : "expense";
  const amount = Number(formData.get("amount"));
  const category = String(formData.get("category") ?? "other");
  const description = String(formData.get("description") ?? "").trim();
  const recurrence = String(formData.get("recurrence") ?? "").trim();
  if (!description || Number.isNaN(amount) || amount <= 0) return;

  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("finance_transactions").insert({
    user_id: user.id,
    direction,
    amount,
    category,
    description,
    recurrence: recurrence || null,
  });
  must(error, "Logging the transaction");
  revalidatePath("/finance");
}

export async function deleteTransaction(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("finance_transactions").delete().eq("id", id);
  must(error, "Deleting the transaction");
  revalidatePath("/finance");
}

export async function deleteGoal(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("finance_goals").delete().eq("id", id);
  must(error, "Deleting the goal");
  revalidatePath("/finance");
}
