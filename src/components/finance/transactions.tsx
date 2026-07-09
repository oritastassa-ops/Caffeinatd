"use client";

import { useTransition } from "react";
import { FinanceTransaction, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/types";
import { moneyExact } from "@/lib/finance/format";
import { addTransaction, deleteTransaction } from "@/app/(app)/finance/actions";
import { cn } from "@/lib/utils";

export function TransactionsList({ transactions }: { transactions: FinanceTransaction[] }) {
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <form action={addTransaction} className="flex flex-wrap gap-2">
        <select name="direction" className={selectCls} defaultValue="expense">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          name="description"
          placeholder="What was it?"
          autoComplete="off"
          className="min-w-[160px] flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input
          name="amount"
          type="number"
          step="0.01"
          placeholder="$"
          className="w-24 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <select name="category" className={selectCls} defaultValue="food">
          {[...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES.filter((c) => c !== "other")].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button className="transition-fast rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-90">
          Add
        </button>
      </form>

      {transactions.length === 0 ? (
        <p className="text-sm text-text-dim">
          Nothing logged yet — try ⌘K: &ldquo;I spent $12 on lunch&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col">
          {transactions.map((t) => (
            <li key={t.id} className="group flex items-baseline gap-3 border-b py-2 text-sm last:border-b-0">
              <span className="tabular w-20 shrink-0 text-xs text-text-dim">{t.occurred_on.slice(5)}</span>
              <span className="min-w-0 flex-1 truncate">
                {t.description}
                <span className="ml-2 text-xs text-text-dim">{t.category}</span>
                {t.recurrence && !t.recurrence_id && (
                  <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-dim">recurring</span>
                )}
              </span>
              <span className={cn("tabular shrink-0", t.direction === "income" ? "text-good" : "")}>
                {t.direction === "income" ? "+" : "−"}
                {moneyExact(t.amount)}
              </span>
              <button
                aria-label="Delete"
                onClick={() => startTransition(() => deleteTransaction(t.id))}
                className="transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const selectCls = "rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";
