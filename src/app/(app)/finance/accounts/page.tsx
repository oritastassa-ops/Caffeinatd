import { requireUser } from "@/lib/supabase/server";
import { Button, Card, CardTitle, Input, PageHeader, Select } from "@/components/ui";
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
      <PageHeader title="Accounts" back={{ href: "/finance", label: "Finance" }} />

      <Card>
        <CardTitle>Add account</CardTitle>
        <form action={addAccount} className="flex flex-wrap items-end gap-2">
          <Input
            name="name"
            aria-label="Account name"
            placeholder="Name (e.g. Wealthsimple TFSA)"
            autoComplete="off"
            containerClassName="min-w-[180px] flex-1"
          />
          <Select name="kind" aria-label="Account type" defaultValue="checking" containerClassName="w-40">
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
          </Select>
          <Input
            name="balance"
            aria-label="Balance"
            type="number"
            step="0.01"
            placeholder="Balance $"
            containerClassName="w-32"
          />
          <Input
            name="expected_return_pct"
            aria-label="Expected return percent per year"
            type="number"
            step="0.1"
            placeholder="Return %/yr (opt.)"
            containerClassName="w-40"
          />
          <Button type="submit">Add</Button>
        </form>
        <p className="mt-2 text-xs text-text-dim">
          Set an expected annual return on investment accounts to power goal forecasts and growth
          projections. Click any balance below to update it.
        </p>
      </Card>

      {/* Assets and liabilities are parallel — side by side on desktop. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Assets · {money(nw.assets)}</CardTitle>
          <AccountsList accounts={assets} />
        </Card>
        <Card>
          <CardTitle>Liabilities · {money(nw.liabilities)}</CardTitle>
          <AccountsList accounts={liabilities} />
        </Card>
      </div>
    </div>
  );
}
