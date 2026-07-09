import { SupabaseClient } from "@supabase/supabase-js";
import { FinanceAccount, FinanceGoal, FinanceSnapshot, FinanceTransaction } from "@/lib/types";
import { occurrencesBetween } from "./cashflow";

export interface FinanceData {
  accounts: FinanceAccount[];
  transactions: FinanceTransaction[]; // trailing 12 months — enough for every derived figure
  goals: FinanceGoal[];
  snapshots: FinanceSnapshot[];
}

/** One fetch for everything the engine derives from — pages and tools share it. */
export async function fetchFinanceData(supabase: SupabaseClient, userId: string): Promise<FinanceData> {
  const yearAgo = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: accounts }, { data: transactions }, { data: goals }, { data: snapshots }] =
    await Promise.all([
      supabase.from("finance_accounts").select("*").eq("user_id", userId),
      supabase
        .from("finance_transactions")
        .select("*")
        .eq("user_id", userId)
        .gte("occurred_on", yearAgo)
        .order("occurred_on", { ascending: false }),
      supabase.from("finance_goals").select("*").eq("user_id", userId).is("achieved_at", null),
      supabase
        .from("finance_snapshots")
        .select("snapshot_date, net_worth, assets, liabilities")
        .eq("user_id", userId)
        .order("snapshot_date", { ascending: true }),
    ]);

  return {
    accounts: normalizeNumbers(accounts ?? [], ["balance", "expected_return_pct"]) as FinanceAccount[],
    transactions: normalizeNumbers(transactions ?? [], ["amount"]) as FinanceTransaction[],
    goals: normalizeNumbers(goals ?? [], ["target_amount", "current_amount", "monthly_contribution"]) as FinanceGoal[],
    snapshots: normalizeNumbers(snapshots ?? [], ["net_worth", "assets", "liabilities"]) as FinanceSnapshot[],
  };
}

/** Postgres numeric comes back as strings via PostgREST — coerce once at the boundary. */
function normalizeNumbers<T extends Record<string, unknown>>(rows: T[], fields: string[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const f of fields) {
      if (out[f] !== null && out[f] !== undefined) out[f] = Number(out[f]);
    }
    return out as T;
  });
}

/** Writes (or overwrites) today's net-worth snapshot — called after balance changes and by cron. */
export async function writeSnapshot(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data: accounts } = await supabase
    .from("finance_accounts")
    .select("side, balance")
    .eq("user_id", userId)
    .is("archived_at", null);
  const rows = (accounts ?? []).map((a) => ({ ...a, balance: Number(a.balance) }));
  const assets = rows.filter((a) => a.side === "asset").reduce((s, a) => s + a.balance, 0);
  const liabilities = rows.filter((a) => a.side === "liability").reduce((s, a) => s + a.balance, 0);

  await supabase.from("finance_snapshots").upsert({
    user_id: userId,
    snapshot_date: new Date().toISOString().slice(0, 10),
    net_worth: Math.round((assets - liabilities) * 100) / 100,
    assets: Math.round(assets * 100) / 100,
    liabilities: Math.round(liabilities * 100) / 100,
  });
}

/** Materializes due occurrences of recurring transactions (idempotent) — called from the cron. */
export async function materializeRecurringTransactions(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data: templates } = await supabase
    .from("finance_transactions")
    .select("*")
    .eq("user_id", userId)
    .not("recurrence", "is", null)
    .is("recurrence_id", null);

  const today = new Date().toISOString().slice(0, 10);
  let created = 0;

  for (const t of templates ?? []) {
    // Occurrences due since the template's anchor, up to today.
    const due = occurrencesBetween(t.occurred_on, t.recurrence, t.occurred_on, today);
    if (due.length === 0) continue;

    const { data: existing } = await supabase
      .from("finance_transactions")
      .select("occurred_on")
      .eq("recurrence_id", t.id);
    const existingDates = new Set((existing ?? []).map((e) => e.occurred_on));

    for (const date of due.filter((d) => !existingDates.has(d))) {
      const { error } = await supabase.from("finance_transactions").insert({
        user_id: userId,
        direction: t.direction,
        amount: t.amount,
        category: t.category,
        description: t.description,
        occurred_on: date,
        account_id: t.account_id,
        recurrence_id: t.id,
      });
      if (!error) created++;
    }
  }
  return created;
}
