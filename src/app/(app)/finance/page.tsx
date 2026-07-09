import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { Card, CardTitle } from "@/components/ui";
import { fetchFinanceData } from "@/lib/finance/data";
import { computeNetWorth } from "@/lib/finance/networth";
import { computeMonthCashflow, computeUpcoming } from "@/lib/finance/cashflow";
import { forecastGoal } from "@/lib/finance/forecast";
import { computeFinancialHealth } from "@/lib/finance/health";
import { money, moneyDelta } from "@/lib/finance/format";
import { NetWorthSparkline } from "@/components/finance/networth-sparkline";
import { PixelAvatar } from "@/components/avatars/pixel-avatar";
import { FinanceHealthCard } from "@/components/finance/health-card";
import { GoalsList } from "@/components/finance/goals-card";
import { TransactionsList } from "@/components/finance/transactions";
import { WeeklyFinanceReview } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const { supabase, user } = await requireUser();
  const data = await fetchFinanceData(supabase, user.id);

  const nw = computeNetWorth(data.accounts, data.snapshots);
  const thisMonth = computeMonthCashflow(data.transactions, new Date().toISOString().slice(0, 7));
  const forecasts = data.goals.map((g) =>
    forecastGoal(g, data.accounts.find((a) => a.id === g.linked_account_id) ?? null),
  );
  const health = computeFinancialHealth(data.accounts, data.transactions, forecasts);
  const upcoming = computeUpcoming(data.transactions, 14);

  const { data: reviewRow } = await supabase
    .from("finance_reviews")
    .select("review")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  const review = reviewRow?.review as WeeklyFinanceReview | undefined;

  const isEmpty = data.accounts.length === 0 && data.transactions.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/finance/accounts" className="text-text-dim hover:text-text hover:underline">
            Accounts
          </Link>
          <Link href="/finance/simulator" className="text-accent hover:underline">
            Simulator
          </Link>
        </div>
      </div>

      {isEmpty && (
        <Card className="card-enter border-accent/30 bg-accent-soft/40">
          <div className="flex items-center gap-3">
            <PixelAvatar personality="analytical" size={44} mode="idle" />
            <p className="text-base font-medium">Juan&rsquo;s ledger is empty — for now ☕</p>
          </div>
          <p className="mt-1 text-sm text-text-dim">
            Add an account below, or just tell me what happened — ⌘K and &ldquo;I spent $12 on
            lunch&rdquo; or &ldquo;I got paid $2,800&rdquo;. I&rsquo;ll take it from there.
          </p>
          <Link
            href="/finance/accounts"
            className="transition-fast mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Add your first account
          </Link>
        </Card>
      )}

      {/* Hero: net worth */}
      <Card className="card-enter">
        <CardTitle>Net worth</CardTitle>
        <div className="flex items-baseline gap-3">
          <p className="tabular text-3xl font-semibold">{money(nw.netWorth)}</p>
          {nw.monthlyChange !== null && (
            <span className={`tabular text-sm ${nw.monthlyChange >= 0 ? "text-good" : "text-bad"}`}>
              {moneyDelta(nw.monthlyChange)} this month
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-dim">
          {money(nw.assets)} in assets · {money(nw.liabilities)} in liabilities
        </p>
        <div className="mt-3">
          <NetWorthSparkline snapshots={data.snapshots} />
        </div>
      </Card>

      {/* Glance row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardTitle>Cash available</CardTitle>
          <p className="tabular text-2xl font-semibold">{money(nw.cashAvailable)}</p>
          {health.emergencyFundMonths !== null && (
            <p className="text-xs text-text-dim">~{health.emergencyFundMonths.toFixed(1)} months of expenses</p>
          )}
        </Card>
        <Card>
          <CardTitle>Spent this month</CardTitle>
          <p className="tabular text-2xl font-semibold">{money(thisMonth.expenses)}</p>
          {thisMonth.byCategory[0] && (
            <p className="text-xs text-text-dim">
              most on {thisMonth.byCategory[0].category} ({money(thisMonth.byCategory[0].amount)})
            </p>
          )}
        </Card>
        <Card>
          <CardTitle>Savings rate</CardTitle>
          <p className="tabular text-2xl font-semibold">{thisMonth.income > 0 ? `${thisMonth.savingsRate}%` : "—"}</p>
          <p className="text-xs text-text-dim">
            {thisMonth.income > 0 ? `${money(thisMonth.income)} in this month` : "no income logged yet"}
          </p>
        </Card>
        <FinanceHealthCard score={health.score} factors={health.factors} />
      </div>

      {/* Weekly review */}
      {review && (
        <Card className="border-accent/30 bg-accent-soft/40">
          <div className="flex items-start gap-3">
            <PixelAvatar personality="analytical" size={40} mode="idle" className="mt-0.5" />
            <div className="min-w-0">
              <CardTitle>Weekly review · week of {review.weekStart}</CardTitle>
              <p className="text-sm leading-relaxed">{review.narrative}</p>
              <p className="tabular mt-2 text-xs text-text-dim">
                {money(review.income)} in · {money(review.expenses)} out · {review.savingsRate}% saved
                {review.netWorthChange !== null && <> · net worth {moneyDelta(review.netWorthChange)}</>}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Goals */}
      <Card>
        <CardTitle>Goals</CardTitle>
        <GoalsList forecasts={forecasts} />
      </Card>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Card>
          <CardTitle>Upcoming (14 days)</CardTitle>
          <ul className="flex flex-col gap-2">
            {upcoming.map((u, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="tabular w-20 shrink-0 text-xs text-text-dim">{u.dueOn.slice(5)}</span>
                <span className="min-w-0 flex-1 truncate">{u.description}</span>
                <span className={`tabular ${u.direction === "income" ? "text-good" : ""}`}>
                  {u.direction === "income" ? "+" : "−"}
                  {money(u.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Transactions */}
      <Card>
        <CardTitle>Recent activity</CardTitle>
        <TransactionsList transactions={data.transactions.slice(0, 25)} />
      </Card>
    </div>
  );
}
