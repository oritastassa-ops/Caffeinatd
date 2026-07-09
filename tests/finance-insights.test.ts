import { describe, expect, it } from "vitest";
import { financeInsightCandidates } from "@/lib/insights/finance";
import { account, goal, tx } from "./finance-fixtures";

const LATE_MONTH = new Date("2026-07-25T12:00:00Z"); // category-swing rule only fires from the 20th

describe("finance insights (deterministic rules)", () => {
  it("flags the biggest category swing vs. last month, late in the month", () => {
    const candidates = financeInsightCandidates(
      {
        accounts: [],
        transactions: [
          tx({ id: "a", amount: 400, category: "food", occurred_on: "2026-06-10" }),
          tx({ id: "b", amount: 150, category: "food", occurred_on: "2026-07-10" }), // −62%
        ],
        goals: [],
        snapshots: [],
      },
      LATE_MONTH,
    );
    const swing = candidates.find((c) => c.dedupKey.startsWith("finance:category_swing:"));
    expect(swing).toBeDefined();
    expect(swing!.message).toContain("less on food");
  });

  it("stays quiet on category swings early in the month", () => {
    const candidates = financeInsightCandidates(
      {
        accounts: [],
        transactions: [
          tx({ id: "a", amount: 400, category: "food", occurred_on: "2026-06-10" }),
          tx({ id: "b", amount: 50, category: "food", occurred_on: "2026-07-02" }),
        ],
        goals: [],
        snapshots: [],
      },
      new Date("2026-07-03T12:00:00Z"),
    );
    expect(candidates.some((c) => c.dedupKey.startsWith("finance:category_swing:"))).toBe(false);
  });

  it("celebrates an emergency-fund milestone with the math shown", () => {
    const candidates = financeInsightCandidates(
      {
        accounts: [account({ kind: "savings", balance: 10000 })],
        transactions: [
          tx({ id: "e1", amount: 2000, category: "housing", occurred_on: "2026-06-05" }),
          tx({ id: "e2", amount: 2000, category: "housing", occurred_on: "2026-05-05" }),
        ],
        goals: [],
        snapshots: [],
      },
      LATE_MONTH,
    );
    const milestone = candidates.find((c) => c.dedupKey.startsWith("finance:emergency_months:"));
    expect(milestone).toBeDefined();
    expect(milestone!.message).toContain("5 months");
  });

  it("flags a goal behind its deadline with an actionable what-if preset", () => {
    const candidates = financeInsightCandidates(
      {
        accounts: [],
        transactions: [],
        goals: [goal({ deadline: "2026-09-01", monthly_contribution: 100 })], // needs 60 months
        snapshots: [],
      },
      LATE_MONTH,
    );
    const behind = candidates.find((c) => c.dedupKey.startsWith("finance:goal_behind:"));
    expect(behind).toBeDefined();
    expect(behind!.actionPreset).toContain("what if");
  });

  it("warns when an upcoming recurring bill exceeds available cash", () => {
    const candidates = financeInsightCandidates(
      {
        accounts: [account({ kind: "checking", balance: 500 })],
        transactions: [
          tx({ id: "rent", description: "Rent", amount: 1400, category: "housing", occurred_on: "2026-01-01", recurrence: "FREQ=MONTHLY" }),
        ],
        goals: [],
        snapshots: [],
      },
      LATE_MONTH,
    );
    const shortfall = candidates.find((c) => c.dedupKey.startsWith("finance:cash_shortfall:"));
    expect(shortfall).toBeDefined();
    expect(shortfall!.importance).toBe(5);
  });
});
