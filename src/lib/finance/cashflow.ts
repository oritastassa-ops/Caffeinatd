import { FinanceTransaction } from "@/lib/types";
import { round2, sum } from "./networth";

export interface MonthCashflow {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
  net: number;
  savingsRate: number; // 0-100; 0 when income is 0
  byCategory: { category: string; amount: number }[]; // expenses only, descending
}

/** Aggregates actual transaction rows for one calendar month. */
export function computeMonthCashflow(transactions: FinanceTransaction[], month: string): MonthCashflow {
  const rows = transactions.filter((t) => t.occurred_on.startsWith(month));
  const income = round2(sum(rows.filter((t) => t.direction === "income").map((t) => t.amount)));
  const expenses = round2(sum(rows.filter((t) => t.direction === "expense").map((t) => t.amount)));

  const catMap = new Map<string, number>();
  for (const t of rows.filter((r) => r.direction === "expense")) {
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + t.amount);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    month,
    income,
    expenses,
    net: round2(income - expenses),
    savingsRate: income > 0 ? Math.round(((income - expenses) / income) * 100) : 0,
    byCategory,
  };
}

/** Trailing average monthly income/expenses over the last `months` full months — the engine's
 *  "expected monthly" figures for forecasting and health. Deterministic, from actual rows. */
export function computeMonthlyAverages(
  transactions: FinanceTransaction[],
  months = 3,
  today = new Date(),
): { avgIncome: number; avgExpenses: number; monthsWithData: number } {
  const monthKeys: string[] = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const flows = monthKeys.map((m) => computeMonthCashflow(transactions, m));
  const withData = flows.filter((f) => f.income > 0 || f.expenses > 0);
  if (withData.length === 0) {
    // Fall back to the current (partial) month so a brand-new user still gets numbers.
    const current = computeMonthCashflow(transactions, today.toISOString().slice(0, 7));
    return { avgIncome: current.income, avgExpenses: current.expenses, monthsWithData: current.income || current.expenses ? 1 : 0 };
  }
  return {
    avgIncome: round2(sum(withData.map((f) => f.income)) / withData.length),
    avgExpenses: round2(sum(withData.map((f) => f.expenses)) / withData.length),
    monthsWithData: withData.length,
  };
}

/* ── Minimal recurrence subset ─────────────────────────────────────────────
 * Same column convention as tasks: an RRULE string. Only the subset the UI
 * offers is parsed — FREQ=WEEKLY|MONTHLY|YEARLY with optional INTERVAL=n —
 * anchored on the template row's occurred_on. Anything unparseable yields
 * no occurrences rather than wrong ones. */

export interface Recurrence {
  freq: "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
}

export function parseRecurrence(rrule: string | null): Recurrence | null {
  if (!rrule) return null;
  const freqMatch = rrule.match(/FREQ=(WEEKLY|MONTHLY|YEARLY)/i);
  if (!freqMatch) return null;
  const intervalMatch = rrule.match(/INTERVAL=(\d+)/i);
  return {
    freq: freqMatch[1]!.toUpperCase() as Recurrence["freq"],
    interval: intervalMatch ? Math.max(1, Number(intervalMatch[1])) : 1,
  };
}

/** Occurrence dates of a recurring template in (after, until], both YYYY-MM-DD exclusive/inclusive. */
export function occurrencesBetween(
  anchor: string,
  rrule: string | null,
  after: string,
  until: string,
): string[] {
  const rec = parseRecurrence(rrule);
  if (!rec) return [];
  const out: string[] = [];
  const d = new Date(`${anchor}T00:00:00Z`);
  // Guard: cap iterations so a degenerate anchor can't loop forever.
  for (let i = 0; i < 500; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    if (dateStr > until) break;
    if (dateStr > after) out.push(dateStr);
    if (rec.freq === "WEEKLY") d.setUTCDate(d.getUTCDate() + 7 * rec.interval);
    else if (rec.freq === "MONTHLY") d.setUTCMonth(d.getUTCMonth() + rec.interval);
    else d.setUTCFullYear(d.getUTCFullYear() + rec.interval);
  }
  return out;
}

export interface UpcomingItem {
  description: string;
  direction: "income" | "expense";
  amount: number;
  category: string;
  dueOn: string;
}

/** Recurring templates' next occurrences within the coming `days` — "Upcoming bills". */
export function computeUpcoming(
  transactions: FinanceTransaction[],
  days = 14,
  today = new Date(),
): UpcomingItem[] {
  const todayStr = today.toISOString().slice(0, 10);
  const untilStr = new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const templates = transactions.filter((t) => t.recurrence && !t.recurrence_id);

  return templates
    .flatMap((t) =>
      occurrencesBetween(t.occurred_on, t.recurrence, todayStr, untilStr).map((dueOn) => ({
        description: t.description,
        direction: t.direction,
        amount: t.amount,
        category: t.category,
        dueOn,
      })),
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}
