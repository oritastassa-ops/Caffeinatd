"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NotificationChannelName } from "@/lib/notifications/types";

const LABELS: Record<NotificationChannelName, string> = { email: "email", sms: "SMS" };

/**
 * One button per channel that can actually deliver (configured AND verified).
 * Sends a real message and reports the outcome inline — the affordance that
 * turns "I think it's set up" into "it works".
 */
export function TestSend({ testableChannels }: { testableChannels: NotificationChannelName[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<NotificationChannelName | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send(channel: NotificationChannelName) {
    setBusy(channel);
    setResult(null);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      setResult(
        res.ok && data.ok
          ? { ok: true, message: `Sent — check your ${LABELS[channel]}.` }
          : { ok: false, message: data.error ?? "The test didn't send." },
      );
      router.refresh(); // the test appears in the delivery log
    } catch {
      setResult({ ok: false, message: "Couldn't reach Caffeinatd — try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border bg-surface p-5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-dim">Test send</h2>
      <p className="mb-3 text-sm text-text-dim">Send yourself a real message to confirm a channel works end to end.</p>
      {testableChannels.length === 0 ? (
        <p className="text-sm text-text-dim">Verify a contact above to enable a test send.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {testableChannels.map((ch) => (
            <button
              key={ch}
              onClick={() => send(ch)}
              disabled={busy !== null}
              className="transition-fast rounded-xl border px-3.5 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
            >
              {busy === ch ? "Sending…" : `Send test ${LABELS[ch]}`}
            </button>
          ))}
        </div>
      )}
      {result && (
        <p className={`mt-3 text-sm ${result.ok ? "text-good" : "text-bad"}`}>{result.message}</p>
      )}
    </div>
  );
}
