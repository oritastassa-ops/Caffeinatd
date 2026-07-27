"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactView } from "@/lib/notifications/settings-data";

const inputCls = "w-full rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";
const btnPrimary = "transition-fast rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost = "transition-fast rounded-xl border px-3.5 py-2 text-sm font-medium hover:border-accent disabled:opacity-50";

type Channel = "email" | "sms";

export function ContactsSection({ contacts }: { contacts: ContactView[] }) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("email");
  const [address, setAddress] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null); // contact awaiting a code
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null); // existing pending row, code shown

  async function sendCode() {
    if (!address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, address: address.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Couldn't send a code."); return; }
      setPendingId(data.contactId);
      setCode("");
    } catch {
      setError("Couldn't reach Caffeinatd — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(contactId: string) {
    if (!/^\d{6}$/.test(code)) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications/contacts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "That code didn't work."); return; }
      setPendingId(null);
      setVerifyingId(null);
      setAddress("");
      setCode("");
      router.refresh();
    } catch {
      setError("Couldn't reach Caffeinatd — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: ContactView) {
    if (!confirm(`Remove ${c.masked}? Notifications set to this ${c.channel === "sms" ? "number" : "address"} will stop.`)) return;
    await fetch(`/api/notifications/contacts/${c.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="rounded-xl border bg-surface p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-dim">Contacts</h2>

      {contacts.length === 0 ? (
        <p className="mb-4 text-sm text-text-dim">No contacts yet. Add an email or phone number below to start getting notified.</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-surface-2 px-3 py-2.5 text-sm">
              <span className="text-text-dim">{c.channel === "email" ? "✉" : "☎"}</span>
              <span className="font-medium">{c.masked}</span>
              {c.optedOut ? (
                <span className="rounded-md bg-bad/10 px-2 py-0.5 text-xs text-bad">Opted out — replied STOP</span>
              ) : c.verified ? (
                <span className="rounded-md bg-good/10 px-2 py-0.5 text-xs text-good">✓ Verified</span>
              ) : (
                <span className="rounded-md bg-bean/10 px-2 py-0.5 text-xs text-bean">Pending — verify</span>
              )}
              <div className="ml-auto flex items-center gap-3">
                {!c.verified && !c.optedOut && verifyingId !== c.id && (
                  <button onClick={() => { setVerifyingId(c.id); setPendingId(c.id); setError(null); }} className="text-accent hover:underline">
                    Enter code
                  </button>
                )}
                <button onClick={() => remove(c)} className="text-text-dim hover:text-bad hover:underline">Remove</button>
              </div>
              {verifyingId === c.id && (
                <div className="flex w-full items-center gap-2 pt-1">
                  <input
                    inputMode="numeric" maxLength={6} value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="6-digit code" className={`${inputCls} max-w-[160px]`} autoFocus
                  />
                  <button onClick={() => verify(c.id)} disabled={busy} className={btnPrimary}>Verify</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add flow — no page navigation */}
      {pendingId && !verifyingId ? (
        <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
          <p className="text-sm">We sent a code to <span className="font-medium">{address}</span>. Enter it to verify.</p>
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code" className={`${inputCls} max-w-[160px]`} autoFocus
            />
            <button onClick={() => verify(pendingId)} disabled={busy} className={btnPrimary}>{busy ? "Verifying…" : "Verify"}</button>
            <button onClick={sendCode} disabled={busy} className="text-sm text-text-dim hover:underline">Resend</button>
            <button onClick={() => { setPendingId(null); setCode(""); }} className="text-sm text-text-dim hover:underline">Cancel</button>
          </div>
        </div>
      ) : !verifyingId ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={`${inputCls} max-w-[110px]`}>
            <option value="email">Email</option>
            <option value="sms">Phone</option>
          </select>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCode()}
            placeholder={channel === "email" ? "you@example.com" : "+14155550123"}
            className={`${inputCls} max-w-[240px] flex-1`}
          />
          <button onClick={sendCode} disabled={busy || !address.trim()} className={btnGhost}>{busy ? "Sending…" : "Send code"}</button>
        </div>
      ) : null}

      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
