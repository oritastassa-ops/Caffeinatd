"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EffectivePreference } from "@/lib/notifications/preferences";
import { deriveCellState } from "@/lib/notifications/matrix";
import { NotificationChannelName, NotificationKind } from "@/lib/notifications/types";
import { saveNotificationPreferences } from "@/app/(app)/settings/notifications/actions";

const KIND_LABELS: Record<NotificationKind, string> = {
  daily_plan: "Daily plan",
  reminder: "Reminders",
  insight: "Insights",
  finance_review: "Finance review",
  fitness_nudge: "Fitness nudges",
  system: "Direct messages",
};
const CHANNELS: NotificationChannelName[] = ["email", "sms"];
const CHANNEL_LABELS: Record<NotificationChannelName, string> = { email: "Email", sms: "SMS" };
const inputCls = "w-full rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

interface EditablePref {
  kind: NotificationKind;
  enabled: boolean;
  channels: Set<NotificationChannelName>;
  digest: boolean;
}

export function PreferenceMatrix({
  preferences,
  configuredChannels,
  verifiedChannels,
  timezone,
  smsEditable,
}: {
  preferences: EffectivePreference[];
  configuredChannels: NotificationChannelName[];
  verifiedChannels: NotificationChannelName[];
  timezone: string;
  smsEditable: boolean;
}) {
  const router = useRouter();
  const configured = new Set(configuredChannels);
  const verified = new Set(verifiedChannels);
  const first = preferences[0];

  const [prefs, setPrefs] = useState<EditablePref[]>(
    preferences.map((p) => ({ kind: p.kind, enabled: p.enabled, channels: new Set(p.channels), digest: p.digest })),
  );
  const [quietStart, setQuietStart] = useState(first?.quietHoursStart?.slice(0, 5) ?? "");
  const [quietEnd, setQuietEnd] = useState(first?.quietHoursEnd?.slice(0, 5) ?? "");
  const [smsDaily, setSmsDaily] = useState(first?.smsDailyCap != null ? String(first.smsDailyCap) : "");
  const [smsMonthly, setSmsMonthly] = useState(first?.smsMonthlyCap != null ? String(first.smsMonthlyCap) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCell(kind: NotificationKind, channel: NotificationChannelName) {
    setSaved(false);
    setPrefs((prev) =>
      prev.map((p) => {
        if (p.kind !== kind) return p;
        const channels = new Set(p.channels);
        if (channels.has(channel)) channels.delete(channel);
        else channels.add(channel);
        return { ...p, channels };
      }),
    );
  }

  function toggleDigest(kind: NotificationKind) {
    setSaved(false);
    setPrefs((prev) => prev.map((p) => (p.kind === kind ? { ...p, digest: !p.digest } : p)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Number.parseInt(s, 10)) || null);
    const res = await saveNotificationPreferences({
      kinds: prefs.map((p) => ({ kind: p.kind, enabled: p.enabled, channels: [...p.channels], digest: p.digest })),
      quietHoursStart: quietStart || null,
      quietHoursEnd: quietEnd || null,
      smsDailyCap: smsEditable ? num(smsDaily) : first?.smsDailyCap ?? null,
      smsMonthlyCap: smsEditable ? num(smsMonthly) : first?.smsMonthlyCap ?? null,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="rounded-xl border bg-surface p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-dim">Preferences</h2>

      {/* Matrix: stacks per-kind on mobile, grid on desktop */}
      <div className="flex flex-col divide-y">
        <div className="hidden grid-cols-[1fr_auto_auto] items-center gap-x-6 pb-2 text-xs font-medium text-text-dim sm:grid">
          <span>Notification</span>
          {CHANNELS.map((ch) => (
            <span key={ch} className="w-14 text-center">{CHANNEL_LABELS[ch]}</span>
          ))}
        </div>
        {prefs.map((p) => (
          <div key={p.kind} className="grid grid-cols-2 items-center gap-x-6 gap-y-2 py-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="col-span-2 sm:col-span-1">
              <p className="text-sm font-medium">{KIND_LABELS[p.kind]}</p>
              <button
                onClick={() => toggleDigest(p.kind)}
                className={`mt-0.5 text-xs ${p.digest ? "text-accent" : "text-text-dim"} hover:underline`}
                title="Batch a day's items into one email instead of several"
              >
                {p.digest ? "✓ Daily digest" : "Daily digest off"}
              </button>
            </div>
            {CHANNELS.map((ch) => {
              const cell = deriveCellState(p.kind, ch, [...p.channels], configured, verified);
              return (
                <div key={ch} className="flex items-center justify-start sm:w-14 sm:justify-center">
                  <span className="mr-2 text-xs text-text-dim sm:hidden">{CHANNEL_LABELS[ch]}</span>
                  <button
                    role="switch"
                    aria-checked={cell.checked}
                    aria-label={`${CHANNEL_LABELS[ch]} for ${KIND_LABELS[p.kind]}`}
                    disabled={!cell.usable}
                    title={cell.reason ?? undefined}
                    onClick={() => toggleCell(p.kind, ch)}
                    className={`transition-fast relative h-5 w-9 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                      cell.checked && cell.usable ? "bg-accent" : "bg-surface-2 border"
                    }`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${cell.checked && cell.usable ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Quiet hours */}
      <div className="mt-5 border-t pt-4">
        <p className="text-sm font-medium">Quiet hours</p>
        <p className="mb-2 text-xs text-text-dim">No non-urgent notifications during this window, in your timezone ({timezone}). SMS always keeps a 22:00–08:00 floor.</p>
        <div className="flex items-center gap-2 text-sm">
          <input type="time" value={quietStart} onChange={(e) => { setQuietStart(e.target.value); setSaved(false); }} className={`${inputCls} max-w-[140px]`} aria-label="Quiet hours start" />
          <span className="text-text-dim">to</span>
          <input type="time" value={quietEnd} onChange={(e) => { setQuietEnd(e.target.value); setSaved(false); }} className={`${inputCls} max-w-[140px]`} aria-label="Quiet hours end" />
          {(quietStart || quietEnd) && (
            <button onClick={() => { setQuietStart(""); setQuietEnd(""); setSaved(false); }} className="text-xs text-text-dim hover:underline">Clear</button>
          )}
        </div>
      </div>

      {/* SMS caps */}
      {smsEditable && (
        <div className="mt-4 border-t pt-4">
          <p className="text-sm font-medium">SMS spend caps</p>
          <p className="mb-2 text-xs text-text-dim">Over the cap, an SMS is sent as email instead when possible. Blank uses the server default.</p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Per day</span>
              <input type="number" min={0} value={smsDaily} onChange={(e) => { setSmsDaily(e.target.value); setSaved(false); }} className={`${inputCls} max-w-[90px]`} />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Per month</span>
              <input type="number" min={0} value={smsMonthly} onChange={(e) => { setSmsMonthly(e.target.value); setSaved(false); }} className={`${inputCls} max-w-[90px]`} />
            </label>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="transition-fast rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {saving ? "Saving…" : "Save preferences"}
        </button>
        {saved && <span className="text-sm text-good">✓ Saved</span>}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>
    </div>
  );
}
