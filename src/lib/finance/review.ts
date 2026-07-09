import { SupabaseClient } from "@supabase/supabase-js";
import { AIProvider } from "@/lib/ai/types";
import { Profile, WeeklyFinanceReview } from "@/lib/types";
import { fetchFinanceData } from "./data";
import { round2, sum } from "./networth";
import { money } from "./format";

/**
 * Weekly review: all numbers computed deterministically; one LLM call only
 * phrases the narrative (encouraging + actionable, per the brief). Stored one
 * row per week — regeneration overwrites, same pattern as daily plans.
 */
export async function generateWeeklyReview(
  supabase: SupabaseClient,
  provider: AIProvider,
  profile: Profile,
  weekStart: string, // YYYY-MM-DD, Monday
): Promise<WeeklyFinanceReview | null> {
  const data = await fetchFinanceData(supabase, profile.id);
  if (data.transactions.length === 0 && data.accounts.length === 0) return null;

  const weekEnd = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const weekRows = data.transactions.filter((t) => t.occurred_on >= weekStart && t.occurred_on <= weekEnd);
  const income = round2(sum(weekRows.filter((t) => t.direction === "income").map((t) => t.amount)));
  const expenses = round2(sum(weekRows.filter((t) => t.direction === "expense").map((t) => t.amount)));
  const savingsRate = income > 0 ? Math.round(((income - expenses) / income) * 100) : 0;

  const catMap = new Map<string, number>();
  for (const t of weekRows.filter((r) => r.direction === "expense")) {
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + t.amount);
  }
  const topCategories = [...catMap.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  const startSnap = [...data.snapshots].reverse().find((s) => s.snapshot_date <= weekStart);
  const endSnap = [...data.snapshots].reverse().find((s) => s.snapshot_date <= weekEnd);
  const netWorthChange =
    startSnap && endSnap && startSnap.snapshot_date !== endSnap.snapshot_date
      ? round2(endSnap.net_worth - startSnap.net_worth)
      : null;

  let narrative = "";
  try {
    const { text } = await provider.chat({
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are a personal finance coach writing a short weekly review (3-4 sentences, no markdown). " +
            "Highlight one positive habit and one concrete opportunity. Encouraging, specific, never preachy. " +
            "Use ONLY the numbers provided — do not invent any.",
        },
        {
          role: "user",
          content:
            `Week of ${weekStart}: income ${money(income)}, expenses ${money(expenses)}, savings rate ${savingsRate}%. ` +
            (netWorthChange !== null ? `Net worth change: ${money(netWorthChange)}. ` : "") +
            (topCategories.length
              ? `Top spending: ${topCategories.map((c) => `${c.category} ${money(c.amount)}`).join(", ")}.`
              : "No expenses logged this week."),
        },
      ],
    });
    narrative = text.trim();
  } catch {
    // Provider hiccup: store the numbers with a plain fallback line — the
    // review is still useful without the phrasing.
    narrative = `Income ${money(income)}, expenses ${money(expenses)}, savings rate ${savingsRate}%.`;
  }

  const review: WeeklyFinanceReview = {
    weekStart,
    narrative,
    income,
    expenses,
    savingsRate,
    netWorthChange,
    topCategories,
  };

  await supabase.from("finance_reviews").upsert({
    user_id: profile.id,
    week_start: weekStart,
    review,
  });
  return review;
}

/** Monday of the current week in the user's timezone. */
export function currentWeekStart(timezone: string, now = new Date()): string {
  const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const day = local.getDay(); // 0 Sun
  const diff = day === 0 ? 6 : day - 1;
  local.setDate(local.getDate() - diff);
  return local.toLocaleDateString("en-CA");
}
