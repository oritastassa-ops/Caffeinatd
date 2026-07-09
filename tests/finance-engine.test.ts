import { describe, expect, it } from "vitest";
import { computeNetWorth } from "@/lib/finance/networth";
import { computeMonthCashflow, computeMonthlyAverages, computeUpcoming, occurrencesBetween } from "@/lib/finance/cashflow";
import { computeCompound } from "@/lib/finance/compound";
import { contributionSensitivity, forecastGoal } from "@/lib/finance/forecast";
import { account, goal, tx } from "./finance-fixtures";

const TODAY = new Date("2026-07-06T12:00:00Z");

describe("net worth", () => {
  it("sums assets minus liabilities and computes liquid cash", () => {
    const result = computeNetWorth(
      [
        account({ id: "a", kind: "checking", balance: 5000 }),
        account({ id: "b", kind: "tfsa", balance: 12000 }),
        account({ id: "c", kind: "credit_card", side: "liability", balance: 1500 }),
      ],
      [],
      TODAY,
    );
    expect(result.netWorth).toBe(15500);
    expect(result.cashAvailable).toBe(5000); // TFSA isn't liquid
    expect(result.monthlyChange).toBeNull(); // no snapshot history
  });

  it("excludes archived accounts", () => {
    const result = computeNetWorth(
      [account({ balance: 5000 }), account({ id: "x", balance: 9999, archived_at: "2026-01-01" })],
      [], TODAY,
    );
    expect(result.netWorth).toBe(5000);
  });

  it("computes monthly change against a ~30-day-old snapshot but not a fresh one", () => {
    const withOld = computeNetWorth([account({ balance: 6000 })], [
      { snapshot_date: "2026-06-05", net_worth: 5000, assets: 5000, liabilities: 0 },
    ], TODAY);
    expect(withOld.monthlyChange).toBe(1000);

    const withFresh = computeNetWorth([account({ balance: 6000 })], [
      { snapshot_date: "2026-07-05", net_worth: 5000, assets: 5000, liabilities: 0 },
    ], TODAY);
    expect(withFresh.monthlyChange).toBeNull(); // yesterday's snapshot isn't a monthly reference
  });
});

describe("cashflow", () => {
  const txs = [
    tx({ id: "1", direction: "income", category: "salary", amount: 3000, occurred_on: "2026-06-01" }),
    tx({ id: "2", amount: 800, category: "housing", occurred_on: "2026-06-02" }),
    tx({ id: "3", amount: 400, category: "food", occurred_on: "2026-06-15" }),
    tx({ id: "4", amount: 200, category: "food", occurred_on: "2026-07-01" }),
  ];

  it("aggregates a month with savings rate and category breakdown", () => {
    const june = computeMonthCashflow(txs, "2026-06");
    expect(june.income).toBe(3000);
    expect(june.expenses).toBe(1200);
    expect(june.savingsRate).toBe(60);
    expect(june.byCategory[0]).toEqual({ category: "housing", amount: 800 });
  });

  it("computes trailing averages over months that have data", () => {
    const { avgIncome, avgExpenses } = computeMonthlyAverages(txs, 3, TODAY);
    expect(avgIncome).toBe(3000); // June is the only full month with data
    expect(avgExpenses).toBe(1200);
  });

  it("expands monthly recurrences within a window", () => {
    const dates = occurrencesBetween("2026-01-15", "FREQ=MONTHLY", "2026-06-20", "2026-08-20");
    expect(dates).toEqual(["2026-07-15", "2026-08-15"]);
  });

  it("returns no occurrences for an unparseable rule rather than wrong ones", () => {
    expect(occurrencesBetween("2026-01-15", "FREQ=DAILY", "2026-06-20", "2026-08-20")).toEqual([]);
  });

  it("lists upcoming recurring bills, soonest first, ignoring materialized children", () => {
    const upcoming = computeUpcoming(
      [
        tx({ id: "r1", description: "Rent", amount: 1200, category: "housing", occurred_on: "2026-01-01", recurrence: "FREQ=MONTHLY" }),
        tx({ id: "r2", description: "Rent (July)", amount: 1200, occurred_on: "2026-07-01", recurrence: "FREQ=MONTHLY", recurrence_id: "r1" }),
      ],
      30, TODAY,
    );
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.dueOn).toBe("2026-08-01");
  });
});

describe("compound interest", () => {
  it("matches a hand-checked simple case", () => {
    // $1000 at 12%/yr (1%/mo), no contributions, 1 year: 1000 * 1.01^12 ≈ 1126.83
    const r = computeCompound({ initial: 1000, monthlyContribution: 0, years: 1, annualReturnPct: 12 });
    expect(r.futureValue).toBeCloseTo(1126.83, 1);
    expect(r.interestEarned).toBeCloseTo(126.83, 1);
  });

  it("splits contributions from growth and adjusts for inflation", () => {
    const r = computeCompound({ initial: 0, monthlyContribution: 100, years: 10, annualReturnPct: 7, annualInflationPct: 2 });
    expect(r.totalContributions).toBe(12000);
    expect(r.futureValue).toBeGreaterThan(12000);
    expect(r.realFutureValue).toBeLessThan(r.futureValue);
    expect(r.series).toHaveLength(11); // year 0 through 10
  });
});

describe("goal forecasting", () => {
  it("computes months to target from contributions alone", () => {
    const f = forecastGoal(goal({ current_amount: 4000, target_amount: 10000, monthly_contribution: 500 }), null, TODAY);
    expect(f.monthsToTarget).toBe(12);
    expect(f.estimatedCompletion).toBe("2027-07");
    expect(f.progressPercent).toBe(40);
  });

  it("reaches sooner with a linked account earning a return", () => {
    // 20%/yr on $4,000 + $500/mo crosses $10k at month 11 instead of 12.
    const linked = account({ id: "inv", kind: "tfsa", balance: 4000, expected_return_pct: 20 });
    const f = forecastGoal(goal({ linked_account_id: "inv" }), linked, TODAY);
    expect(f.monthsToTarget).toBeLessThan(12);
  });

  it("returns null months when nothing is moving toward the goal", () => {
    const f = forecastGoal(goal({ monthly_contribution: 0, current_amount: 100 }), null, TODAY);
    expect(f.monthsToTarget).toBeNull();
    expect(f.estimatedCompletion).toBeNull();
  });

  it("flags deadline feasibility", () => {
    const onTrack = forecastGoal(goal({ deadline: "2027-12-01" }), null, TODAY);
    expect(onTrack.onTrackForDeadline).toBe(true);
    const behind = forecastGoal(goal({ deadline: "2026-12-01" }), null, TODAY);
    expect(behind.onTrackForDeadline).toBe(false);
  });

  it("quantifies contribution sensitivity ('+$X/mo → N months sooner')", () => {
    const sooner = contributionSensitivity(goal({}), null, 500, TODAY);
    expect(sooner).toBe(6); // 500→1000/mo halves the 12-month runway
  });
});
