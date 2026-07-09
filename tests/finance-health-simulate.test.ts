import { describe, expect, it } from "vitest";
import { computeFinancialHealth } from "@/lib/finance/health";
import { simulate } from "@/lib/finance/simulate";
import { forecastGoal } from "@/lib/finance/forecast";
import { account, goal, tx } from "./finance-fixtures";

const TODAY = new Date("2026-07-06T12:00:00Z");

// Three months of steady history: $3000 in, $2000 out (incl. $300 investing).
const steadyHistory = ["2026-04", "2026-05", "2026-06"].flatMap((m, i) => [
  tx({ id: `i${i}`, direction: "income", category: "salary", amount: 3000, occurred_on: `${m}-01` }),
  tx({ id: `e${i}`, amount: 1700, category: "housing", occurred_on: `${m}-02` }),
  tx({ id: `s${i}`, amount: 300, category: "investments", occurred_on: `${m}-03` }),
]);

describe("financial health score", () => {
  it("earns full marks across the board for a strong position", () => {
    const accounts = [
      account({ id: "chq", kind: "savings", balance: 12000 }), // 6 months of $2000 expenses
      account({ id: "inv", kind: "tfsa", balance: 20000 }),
    ];
    const forecasts = [forecastGoal(goal({ deadline: "2028-01-01" }), null, TODAY)];
    const h = computeFinancialHealth(accounts, steadyHistory, forecasts, TODAY);
    expect(h.score).toBeGreaterThanOrEqual(95);
    expect(h.emergencyFundMonths).toBe(6);
    expect(h.factors).toHaveLength(5);
    for (const f of h.factors) expect(f.reason.length).toBeGreaterThan(5); // every factor explained ("No debt." is valid)
  });

  it("penalizes debt-heavy positions with a named reason", () => {
    const accounts = [
      account({ balance: 2000 }),
      account({ id: "loan", kind: "student_loan", side: "liability", balance: 1500 }),
    ];
    const h = computeFinancialHealth(accounts, steadyHistory, [], TODAY);
    const debt = h.factors.find((f) => f.name === "Debt ratio")!;
    expect(debt.earned).toBeLessThan(debt.max);
    expect(debt.reason).toContain("75%");
  });

  it("degrades gracefully with no history instead of failing or scoring zero", () => {
    const h = computeFinancialHealth([], [], [], TODAY);
    expect(h.score).toBeGreaterThan(0);
    expect(h.emergencyFundMonths).toBeNull();
  });
});

describe("what-if simulation", () => {
  const input = {
    accounts: [account({ id: "chq", kind: "checking", balance: 5000 })],
    transactions: steadyHistory,
    goals: [goal({ current_amount: 4000, monthly_contribution: 500 })],
    cashAvailable: 5000,
  };

  it("baseline: before and after match when the delta is empty", () => {
    const r = simulate(input, {}, TODAY);
    expect(r.after.monthlyNet).toBe(r.before.monthlyNet);
    expect(r.after.cashIn12Months).toBe(r.before.cashIn12Months);
  });

  it("extra monthly savings reduce free cash but pull goal dates in", () => {
    const r = simulate(input, { extraMonthlySavings: 200 }, TODAY);
    expect(r.after.monthlyNet).toBe(r.before.monthlyNet - 200);
    expect(r.after.goals[0]!.monthsToTarget!).toBeLessThan(r.before.goals[0]!.monthsToTarget!);
  });

  it("a one-time purchase shifts the whole cash curve down", () => {
    const r = simulate(input, { oneTimePurchase: 2000 }, TODAY);
    expect(r.after.cashIn12Months).toBe(r.before.cashIn12Months - 2000);
    expect(r.after.cashCurve[0]!.cash).toBe(r.before.cashCurve[0]!.cash - 2000);
  });

  it("an income raise improves monthly net one-for-one", () => {
    const r = simulate(input, { incomeChange: 500 }, TODAY);
    expect(r.after.monthlyNet).toBe(r.before.monthlyNet + 500);
    expect(r.after.cashIn12Months).toBe(r.before.cashIn12Months + 500 * 12);
  });

  it("a large purchase can lower the health score via the emergency fund", () => {
    const r = simulate(input, { oneTimePurchase: 4500 }, TODAY);
    expect(r.after.healthScore).toBeLessThan(r.before.healthScore);
  });
});
