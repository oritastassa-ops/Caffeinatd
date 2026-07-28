import { requireUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
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
      <PageHeader
        title="Simulator"
        description="Drag the sliders — every number recalculates instantly from your real data. The assistant uses exactly the same math when you ask “what if…” in ⌘K."
        back={{ href: "/finance", label: "Finance" }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  );
}
