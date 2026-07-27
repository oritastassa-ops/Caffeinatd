"use client";

import { useState } from "react";
import Link from "next/link";
import type { DeliveryView } from "@/lib/notifications/settings-data";
import { relativeTime } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-good/10 text-good",
  pending: "bg-surface-2 text-text-dim",
  sending: "bg-surface-2 text-text-dim",
  failed: "bg-bad/10 text-bad",
  skipped: "bg-bean/10 text-bean",
};

type Filter = "all" | "sent" | "failed" | "skipped";

/**
 * A view of the last ~50 deliveries, not a raw table. Failures show the
 * user-safe error and, where the fix is user-side, a link to what fixes it.
 * (Pagination is deliberately not built — at personal scale a 50-row window with
 * a filter is enough; note it as a future extension.)
 */
export function DeliveryLog({ deliveries }: { deliveries: DeliveryView[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = deliveries.filter((d) => (filter === "all" ? true : d.status === filter));

  return (
    <div className="rounded-xl border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-dim">Delivery log</h2>
        <div className="flex gap-1 text-xs">
          {(["all", "sent", "failed", "skipped"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-1 capitalize transition-fast focus-visible:ring-2 focus-visible:ring-accent ${
                filter === f ? "bg-accent-soft text-accent" : "text-text-dim hover:text-text"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {deliveries.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-dim">
          Nothing sent yet. Once your daily plan, reminders, or a test send go out, they&apos;ll show here.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-dim">No {filter} deliveries.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[d.status] ?? STATUS_STYLES.pending}`}>
                {d.status}
              </span>
              <span className="text-text-dim">{d.channel === "email" ? "✉" : "☎"}</span>
              <span className="font-medium capitalize">{d.kind.replace(/_/g, " ")}</span>
              {d.destination && <span className="text-text-dim">→ {d.destination}</span>}
              <span className="ml-auto text-xs text-text-dim">{relativeTime(d.sentAt ?? d.createdAt)}</span>
              {(d.status === "failed" || d.status === "skipped") && d.error && (
                <span className="w-full text-xs text-bad">
                  {d.error} <FixLink error={d.error} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** When the failure is user-fixable, point at the exact control that fixes it. */
const USER_FIXABLE = ["verified", "opted out", "cap", "contact", "number", "address"];
function FixLink({ error }: { error: string }) {
  const e = error.toLowerCase();
  if (!USER_FIXABLE.some((needle) => e.includes(needle))) return null;
  return (
    <Link href="#contacts" className="font-medium text-accent underline">
      Fix in Contacts
    </Link>
  );
}
