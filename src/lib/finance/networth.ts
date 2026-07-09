import { FinanceAccount, FinanceSnapshot, LIQUID_KINDS } from "@/lib/types";

export interface NetWorthSummary {
  netWorth: number;
  assets: number;
  liabilities: number;
  cashAvailable: number; // liquid asset kinds only
  monthlyChange: number | null; // vs. closest snapshot ~30 days back; null without history
  yearlyChange: number | null;
}

/** Deterministic — sums live balances; deltas come from stored snapshots. */
export function computeNetWorth(
  accounts: FinanceAccount[],
  snapshots: FinanceSnapshot[],
  today = new Date(),
): NetWorthSummary {
  const active = accounts.filter((a) => !a.archived_at);
  const assets = sum(active.filter((a) => a.side === "asset").map((a) => a.balance));
  const liabilities = sum(active.filter((a) => a.side === "liability").map((a) => a.balance));
  const netWorth = round2(assets - liabilities);
  const cashAvailable = round2(
    sum(active.filter((a) => a.side === "asset" && LIQUID_KINDS.includes(a.kind)).map((a) => a.balance)),
  );

  return {
    netWorth,
    assets: round2(assets),
    liabilities: round2(liabilities),
    cashAvailable,
    monthlyChange: changeSince(netWorth, snapshots, 30, today),
    yearlyChange: changeSince(netWorth, snapshots, 365, today),
  };
}

/** Delta vs. the snapshot closest to `daysBack` days ago (within a ±half-window tolerance). */
function changeSince(
  current: number,
  snapshots: FinanceSnapshot[],
  daysBack: number,
  today: Date,
): number | null {
  if (snapshots.length === 0) return null;
  const targetTime = today.getTime() - daysBack * 86_400_000;
  let best: FinanceSnapshot | null = null;
  let bestDistance = Infinity;
  for (const s of snapshots) {
    const distance = Math.abs(new Date(`${s.snapshot_date}T00:00:00Z`).getTime() - targetTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = s;
    }
  }
  // A "monthly change" against a snapshot from yesterday would be misleading —
  // require the reference point to be at least halfway to the target distance.
  if (!best || bestDistance > (daysBack / 2) * 86_400_000) return null;
  return round2(current - best.net_worth);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
