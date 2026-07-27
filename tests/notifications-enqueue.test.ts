import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ContactRow,
  enqueueNotification,
  planDeliveries,
  planWithCaps,
} from "@/lib/notifications/enqueue";
import { EffectivePreference, PreferenceRow, resolvePreference } from "@/lib/notifications/preferences";
import { CapUsage, SmsCaps } from "@/lib/notifications/limits";

function contact(overrides: Partial<ContactRow>): ContactRow {
  return {
    id: "c1",
    channel: "email",
    address: "me@example.com",
    verified_at: "2026-07-01T00:00:00Z",
    opted_out_at: null,
    is_primary: false,
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const pref = (over: Partial<PreferenceRow>): PreferenceRow => ({
  kind: "reminder",
  enabled: true,
  channels: ["email"],
  quiet_hours_start: null,
  quiet_hours_end: null,
  digest: false,
  sms_daily_cap: null,
  sms_monthly_cap: null,
  downgrade_to_email: true,
  ...over,
});

describe("resolvePreference", () => {
  it("falls back to code defaults when no row exists", () => {
    const p = resolvePreference("reminder", []);
    expect(p).toMatchObject({ enabled: true, channels: ["email"] });
  });

  it("lets a stored row override the default", () => {
    const p = resolvePreference("reminder", [pref({ enabled: false })]);
    expect(p.enabled).toBe(false);
  });

  it("drops unknown channel names from a stored row", () => {
    const p = resolvePreference("reminder", [pref({ channels: ["email", "carrier-pigeon"] })]);
    expect(p.channels).toEqual(["email"]);
  });
});

describe("planDeliveries", () => {
  it("skips a disabled kind entirely", () => {
    const plan = planDeliveries(resolvePreference("reminder", [pref({ enabled: false })]), [
      contact({}),
    ]);
    expect(plan.deliveries).toHaveLength(0);
    expect(plan.skipped[0]).toMatch(/disabled/);
  });

  it("skips a channel with no verified contact", () => {
    const plan = planDeliveries(resolvePreference("reminder", []), [
      contact({ verified_at: null }),
    ]);
    expect(plan.deliveries).toHaveLength(0);
    expect(plan.skipped).toContain("email: no verified contact");
  });

  it("queues verified channels and skips unverified ones", () => {
    const plan = planDeliveries(resolvePreference("reminder", [pref({ channels: ["email", "sms"] })]), [
      contact({ id: "e1", channel: "email", verified_at: "2026-07-01T00:00:00Z" }),
      contact({ id: "s1", channel: "sms", address: "+14155550123", verified_at: null }),
    ]);
    expect(plan.deliveries).toEqual([{ channel: "email", contactId: "e1", address: "me@example.com" }]);
    expect(plan.skipped).toContain("sms: no verified contact");
  });

  it("prefers the primary contact, then the most recent", () => {
    const plan = planDeliveries(resolvePreference("reminder", []), [
      contact({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
      contact({ id: "primary", is_primary: true, created_at: "2026-02-01T00:00:00Z" }),
      contact({ id: "newest", created_at: "2026-07-20T00:00:00Z" }),
    ]);
    expect(plan.deliveries[0]?.contactId).toBe("primary");
  });

  it("skips an opted-out contact (STOP means never queue here again)", () => {
    const plan = planDeliveries(resolvePreference("reminder", [pref({ channels: ["sms"] })]), [
      contact({ id: "s1", channel: "sms", address: "+16502530000", verified_at: "2026-07-01T00:00:00Z", opted_out_at: "2026-07-10T00:00:00Z" }),
    ]);
    expect(plan.deliveries).toHaveLength(0);
    expect(plan.skipped).toContain("sms: no verified contact");
  });
});

// ── planWithCaps (pure cap / downgrade / skip decisions) ─────────────────────

describe("planWithCaps", () => {
  const caps: SmsCaps = { daily: 5, monthly: 100 };
  const smsPref = (over: Partial<EffectivePreference> = {}): EffectivePreference =>
    resolvePreference("reminder", [pref({ channels: ["sms"], downgrade_to_email: over.downgradeToEmail ?? true })]);
  const underCap: CapUsage = { sentToday: 0, sentMonth: 0, inFlight: 0 };
  const atCap: CapUsage = { sentToday: 5, sentMonth: 0, inFlight: 0 };

  const smsDelivery = { channel: "sms" as const, contactId: "s1", address: "+16502530000" };
  const emailContact = contact({ id: "e1", channel: "email", verified_at: "2026-07-01T00:00:00Z" });
  const smsContact = contact({ id: "s1", channel: "sms", address: "+16502530000", verified_at: "2026-07-01T00:00:00Z" });

  it("passes SMS through as pending when under cap", () => {
    const { finals } = planWithCaps({ deliveries: [smsDelivery], skipped: [] }, smsPref(), [smsContact], underCap, caps);
    expect(finals).toEqual([{ ...smsDelivery, status: "pending", lastError: null }]);
  });

  it("downgrades over-cap SMS to a verified email when downgrade is on", () => {
    const { finals, skipped } = planWithCaps(
      { deliveries: [smsDelivery], skipped: [] },
      smsPref({ downgradeToEmail: true }),
      [smsContact, emailContact],
      atCap,
      caps,
    );
    expect(finals).toEqual([{ channel: "email", contactId: "e1", address: "me@example.com", status: "pending", lastError: null }]);
    expect(skipped.some((s) => /downgraded to email/.test(s))).toBe(true);
  });

  it("records a skipped row when over cap with no downgrade target", () => {
    const { finals, skipped } = planWithCaps(
      { deliveries: [smsDelivery], skipped: [] },
      smsPref({ downgradeToEmail: false }),
      [smsContact],
      atCap,
      caps,
    );
    expect(finals).toEqual([{ ...smsDelivery, status: "skipped", lastError: "sms: daily spend cap reached" }]);
    expect(skipped).toContain("sms: daily spend cap reached");
  });

  it("leaves SMS untouched when no cap is active (usage null)", () => {
    const { finals } = planWithCaps({ deliveries: [smsDelivery], skipped: [] }, smsPref(), [smsContact], null, caps);
    expect(finals[0]?.status).toBe("pending");
  });
});

// ── enqueueNotification against a minimal fake Supabase ──────────────────────

function fakeSupabase(prefs: PreferenceRow[], contacts: ContactRow[]) {
  const inserted: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const client = {
    from(table: string) {
      if (table === "notification_deliveries") {
        return {
          insert(row: Record<string, unknown>) {
            if (row.dedupe_key != null) {
              const key = `${row.user_id}|${row.dedupe_key}|${row.channel}`;
              if (seen.has(key)) {
                return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
              }
              seen.add(key);
            }
            inserted.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      const data = table === "notification_preferences" ? prefs : contacts;
      return { select: () => ({ eq: () => Promise.resolve({ data, error: null }) }) };
    },
  };

  return { supabase: client as unknown as SupabaseClient, inserted };
}

describe("enqueueNotification", () => {
  const verified = [contact({ id: "e1", verified_at: "2026-07-01T00:00:00Z" })];

  it("creates a pending row for a verified contact", async () => {
    const { supabase, inserted } = fakeSupabase([], verified);
    const res = await enqueueNotification(supabase, {
      userId: "u1",
      kind: "reminder",
      payload: { message: "call mom" },
    });
    expect(res.queued).toBe(1);
    expect(inserted[0]).toMatchObject({ status: "pending", channel: "email", contact_id: "e1" });
  });

  it("skips (queues nothing) when the only contact is unverified", async () => {
    const { supabase, inserted } = fakeSupabase([], [contact({ verified_at: null })]);
    const res = await enqueueNotification(supabase, { userId: "u1", kind: "reminder", payload: {} });
    expect(res.queued).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(res.skipped).toContain("email: no verified contact");
  });

  it("treats a duplicate dedupeKey as idempotent success, not a new row", async () => {
    const { supabase, inserted } = fakeSupabase([], verified);
    const args = { userId: "u1", kind: "reminder" as const, payload: {}, dedupeKey: "reminder:42" };

    const first = await enqueueNotification(supabase, args);
    const second = await enqueueNotification(supabase, args);

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(1); // reported as queued (already there), not an error
    expect(inserted).toHaveLength(1); // but only one row actually exists
  });

  it("propagates a real (non-conflict) write error", async () => {
    const client = {
      from(table: string) {
        if (table === "notification_deliveries") {
          return { insert: () => Promise.resolve({ error: { code: "42501", message: "RLS denied" } }) };
        }
        const data = table === "notification_preferences" ? [] : verified;
        return { select: () => ({ eq: () => Promise.resolve({ data, error: null }) }) };
      },
    } as unknown as SupabaseClient;

    await expect(
      enqueueNotification(client, { userId: "u1", kind: "reminder", payload: {} }),
    ).rejects.toThrow(/RLS denied/);
  });
});
