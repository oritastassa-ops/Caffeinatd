import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { Card, CardTitle } from "@/components/ui";
import { AccountsList } from "@/components/finance/accounts-list";
import { fetchFinanceData } from "@/lib/finance/data";
import { money } from "@/lib/finance/format";
import { computeNetWorth } from "@/lib/finance/networth";
import { ASSET_KINDS, LIABILITY_KINDS } from "@/lib/types";
import { addAccount } from "../actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const { supabase, user } = await requireUser();
  const data = await fetchFinanceData(supabase, user.id);
  const active = data.accounts.filter((a) => !a.archived_at);
  const assets = active.filter((a) => a.side === "asset");
  const liabilities = active.filter((a) => a.side === "liability");
  const nw = computeNetWorth(data.accounts, data.snapshots);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <Link href="/finance" className="text-sm text-text-dim hover:text-text hover:underline">
          ← Finance
        </Link>
      </div>

      <Card>
        <CardTitle>Add account</CardTitle>
        <form action={addAccount} className="flex flex-wrap gap-2">
          <input
            name="name"
            placeholder="Name (e.g. Wealthsimple TFSA)"
            autoComplete="off"
            className="min-w-[180px] flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <select
            name="kind"
            defaultValue="checking"
            className="rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <optgroup label="Assets">
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </optgroup>
            <optgroup label="Liabilities">
              {LIABILITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </optgroup>
          </select>
          <input
            name="balance"
            type="number"
            step="0.01"
            placeholder="Balance $"
            className="w-32 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            name="expected_return_pct"
            type="number"
            step="0.1"
            placeholder="Return %/yr (opt.)"
            className="w-40 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button className="transition-fast rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-90">
            Add
          </button>
        </form>
        <p className="mt-2 text-xs text-text-dim">
          Set an expected annual return on investment accounts to power goal forecasts and growth
          projections. Click any balance below to update it.
        </p>
      </Card>

      <Card>
        <CardTitle>
          Assets · {money(nw.assets)}
        </CardTitle>
        <AccountsList accounts={assets} />
      </Card>

      <Card>
        <CardTitle>
          Liabilities · {money(nw.liabilities)}
        </CardTitle>
        <AccountsList accounts={liabilities} />
      </Card>
    </div>
  );
}
