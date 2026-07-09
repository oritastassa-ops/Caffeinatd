import { SupabaseClient } from "@supabase/supabase-js";
import { fetchFinanceData } from "./data";
import { computeNetWorth } from "./networth";
import { computeMonthCashflow, computeMonthlyAverages, computeUpcoming } from "./cashflow";
import { forecastGoal } from "./forecast";
import { computeFinancialHealth } from "./health";
import { money } from "./format";

/**
 * Compact text digest handed to the model as a tool result — every number
 * comes from the deterministic engine, never the LLM. The finance analog of
 * lib/fitness/report.ts.
 */
export async function buildFinanceReport(supabase: SupabaseClient, userId: string): Promise<string> {
  const data = await fetchFinanceData(supabase, userId);
  if (data.accounts.length === 0 && data.transactions.length === 0) {
    return "No financial data yet — no accounts or transactions have been added.";
  }

  const lines: string[] = [];
  const nw = computeNetWorth(data.accounts, data.snapshots);
  lines.push(
    `Net worth: ${money(nw.netWorth)} (assets ${money(nw.assets)}, liabilities ${money(nw.liabilities)}). ` +
      `Cash available: ${money(nw.cashAvailable)}.` +
      (nw.monthlyChange !== null ? ` Monthly change: ${money(nw.monthlyChange)}.` : ""),
  );

  const thisMonth = computeMonthCashflow(data.transactions, new Date().toISOString().slice(0, 7));
  const { avgIncome, avgExpenses, monthsWithData } = computeMonthlyAverages(data.transactions);
  lines.push(
    `This month: ${money(thisMonth.income)} in, ${money(thisMonth.expenses)} out (savings rate ${thisMonth.savingsRate}%). ` +
      `Trailing ${monthsWithData || 1}-month averages: income ${money(avgIncome)}, expenses ${money(avgExpenses)}/month.`,
  );
  if (thisMonth.byCategory.length > 0) {
    lines.push(
      "Top spending this month: " +
        thisMonth.byCategory.slice(0, 4).map((c) => `${c.category} ${money(c.amount)}`).join(", ") + ".",
    );
  }

  const forecasts = data.goals.map((g) =>
    forecastGoal(g, data.accounts.find((a) => a.id === g.linked_account_id) ?? null),
  );
  if (forecasts.length > 0) {
    lines.push(
      "Goals: " +
        forecasts
          .map((f) => {
            const eta = f.estimatedCompletion ? `, est. done ${f.estimatedCompletion}` : ", no ETA at current pace";
            const deadline = f.onTrackForDeadline === null ? "" : f.onTrackForDeadline ? " (on track)" : " (BEHIND deadline)";
            return `${f.title} ${f.progressPercent}% (${money(f.currentAmount)} of ${money(f.targetAmount)}${eta})${deadline}`;
          })
          .join("; "),
    );
  }

  const upcoming = computeUpcoming(data.transactions, 14);
  if (upcoming.length > 0) {
    lines.push(
      "Upcoming (14 days): " +
        upcoming.map((u) => `${u.description} ${money(u.amount)} on ${u.dueOn}`).join(", ") + ".",
    );
  }

  const health = computeFinancialHealth(data.accounts, data.transactions, forecasts);
  lines.push(
    `Financial health: ${health.score}/100. ` +
      health.factors.map((f) => `${f.name} ${f.earned}/${f.max} — ${f.reason}`).join(" "),
  );

  return lines.join("\n");
}
