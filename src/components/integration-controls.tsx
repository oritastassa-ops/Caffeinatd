"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** "Sync Now" / "Disconnect" pair — shared by the Settings integrations card. */
export function IntegrationControls({ provider }: { provider: "hevy" }) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function syncNow() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/integrations/${provider}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Sync failed.");
      } else {
        setMessage(`Synced — ${data.imported} new, ${data.updated} updated, ${data.deleted} removed.`);
        router.refresh();
      }
    } catch {
      setMessage("Couldn't reach Caffeinatd.");
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    await fetch(`/api/integrations/${provider}/disconnect`, { method: "POST" });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={syncNow}
          disabled={syncing}
          className="transition-fast rounded-lg border px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
        <button onClick={disconnect} className="text-xs text-bad hover:underline">
          Disconnect
        </button>
      </div>
      {message && <p className="text-xs text-text-dim">{message}</p>}
    </div>
  );
}
