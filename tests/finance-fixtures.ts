import { FinanceAccount, FinanceGoal, FinanceTransaction } from "@/lib/types";

/** Shared builders for finance tests — a plain module, not a .test file, so
 *  importing it never re-registers another file's test suites. */

export function account(overrides: Partial<FinanceAccount>): FinanceAccount {
  return {
    id: "a1", name: "Chequing", kind: "checking", side: "asset", balance: 5000,
    expected_return_pct: null, allocation: null, archived_at: null, ...overrides,
  };
}

export function tx(overrides: Partial<FinanceTransaction>): FinanceTransaction {
  return {
    id: "t1", direction: "expense", amount: 100, category: "food", description: "groceries",
    occurred_on: "2026-07-01", account_id: null, recurrence: null, recurrence_id: null, ...overrides,
  };
}

export function goal(overrides: Partial<FinanceGoal>): FinanceGoal {
  return {
    id: "g1", title: "Emergency fund", description: null, target_amount: 10000, current_amount: 4000,
    linked_account_id: null, monthly_contribution: 500, priority: 3, deadline: null, achieved_at: null,
    ...overrides,
  };
}
