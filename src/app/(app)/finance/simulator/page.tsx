import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { fetchFinanceData } from "@/lib/finance/data";
import { computeNetWorth } from "@/lib/finance/networth";
import { WhatIfSimulator } from "@/components/finance/what-if-simulator";
import { CompoundSimulator } from "@/components/finance/compound-simulator";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const { supabase, user } = await requireUser();
  const data = await fetchFinanceData(supabase, user.id);
  const nw = computeNetWorth(data.accounts, data.snapshots);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Simulator</h1>
        <Link href="/finance" className="text-sm text-text-dim hover:text-text hover:underline">
          ← Finance
        </Link>
      </div>
      <p className="text-sm text-text-dim">
        Drag the sliders — every number recalculates instantly from your real data. The assistant
        uses exactly the same math when you ask &ldquo;what if…&rdquo; in ⌘K.
      </p>

      <WhatIfSimulator
        input={{
          accounts: data.accounts,
          transactions: data.transactions,
          goals: data.goals,
          cashAvailable: nw.cashAvailable,
        }}
      />
      <CompoundSimulator />
    </div>
  );
}
