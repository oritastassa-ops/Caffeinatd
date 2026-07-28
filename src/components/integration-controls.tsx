"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

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
        <Button variant="secondary" size="sm" onClick={syncNow} loading={syncing}>
          {syncing ? "Syncing…" : "Sync Now"}
        </Button>
        <Button variant="danger" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
      {message && <p className="text-xs text-text-dim">{message}</p>}
    </div>
  );
}
