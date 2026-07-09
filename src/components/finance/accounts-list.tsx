"use client";

import { useState, useTransition } from "react";
import { FinanceAccount } from "@/lib/types";
import { money } from "@/lib/finance/format";
import { archiveAccount, updateAccountBalance } from "@/app/(app)/finance/actions";

const KIND_LABELS: Record<string, string> = {
  cash: "Cash", checking: "Chequing", savings: "Savings", tfsa: "TFSA", fhsa: "FHSA",
  rrsp: "RRSP", brokerage: "Brokerage", crypto: "Crypto", vehicle: "Vehicle",
  property: "Property", other_asset: "Other asset", credit_card: "Credit card",
  student_loan: "Student loan", mortgage: "Mortgage", car_loan: "Car loan", other_debt: "Other debt",
};

/** Click a balance to edit it in place — a balance edit is the manual "sync". */
export function AccountsList({ accounts }: { accounts: FinanceAccount[] }) {
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function save(id: string) {
    const value = Number(draft);
    if (!Number.isNaN(value) && value >= 0) {
      startTransition(() => updateAccountBalance(id, value));
    }
    setEditingId(null);
  }

  if (accounts.length === 0) {
    return <p className="text-sm text-text-dim">None yet.</p>;
  }

  return (
    <ul className="flex flex-col">
      {accounts.map((a) => (
        <li key={a.id} className="group flex items-center gap-3 border-b py-2.5 text-sm last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{a.name}</p>
            <p className="text-xs text-text-dim">
              {KIND_LABELS[a.kind] ?? a.kind}
              {a.expected_return_pct !== null && ` · ~${a.expected_return_pct}%/yr`}
              {a.allocation && ` · ${a.allocation}`}
            </p>
          </div>
          {editingId === a.id ? (
            <input
              autoFocus
              type="number"
              step="0.01"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save(a.id)}
              onBlur={() => save(a.id)}
              className="tabular w-28 rounded-md border bg-surface-2 px-2 py-1 text-right text-sm outline-none focus:border-accent"
            />
          ) : (
            <button
              onClick={() => {
                setEditingId(a.id);
                setDraft(String(a.balance));
              }}
              className="tabular hover:underline"
              title="Click to update balance"
            >
              {money(a.balance)}
            </button>
          )}
          <button
            aria-label="Archive account"
            onClick={() => startTransition(() => archiveAccount(a.id))}
            className="transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
