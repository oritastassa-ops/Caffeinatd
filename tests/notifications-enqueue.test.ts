import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ContactRow,
  enqueueNotification,
  planDeliveries,
} from "@/lib/notifications/enqueue";
import { PreferenceRow, resolvePreference } from "@/lib/notifications/preferences";

function contact(overrides: Partial<ContactRow>): ContactRow {
  return {
    id: "c1",
    channel: "email",
    address: "me@example.com",
    verified_at: "2026-07-01T00:00:00Z",
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
