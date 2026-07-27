import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchDueReminders } from "@/lib/notifications/reminders";

/**
 * In-memory Supabase good enough for enqueue + dispatch: filters, insert with the
 * (user_id, dedupe_key, channel) unique index, update, maybeSingle, count/head.
 */
type Row = Record<string, unknown>;
interface Store {
  profiles: Row[];
  notification_preferences: Row[];
  notification_contacts: Row[];
  notification_deliveries: Row[];
  reminders: Row[];
  [table: string]: Row[];
}

class Query {
  private op: "select" | "insert" | "update" = "select";
  private filters: [string, string, unknown][] = [];
  private insertRow: Row | null = null;
  private patch: Row = {};
  private wantCount = false;
  private single = false;
  constructor(private store: Store, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "insert" && this.op !== "update") this.op = "select";
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(row: Row) { this.op = "insert"; this.insertRow = row; return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  eq(c: string, v: unknown) { this.filters.push(["eq", c, v]); return this; }
  neq(c: string, v: unknown) { this.filters.push(["neq", c, v]); return this; }
  lte(c: string, v: unknown) { this.filters.push(["lte", c, v]); return this; }
  gte(c: string, v: unknown) { this.filters.push(["gte", c, v]); return this; }
  lt(c: string, v: unknown) { this.filters.push(["lt", c, v]); return this; }
  is(c: string, v: unknown) { this.filters.push(["is", c, v]); return this; }
  in(c: string, v: unknown) { this.filters.push(["in", c, v]); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.single = true; return this; }

  private rows(): Row[] {
    return (this.store[this.table] ?? []).filter((r) =>
      this.filters.every(([k, c, v]) => {
        const cell = r[c];
        if (k === "eq") return cell === v;
        if (k === "neq") return cell !== v;
        if (k === "is") return v === null ? cell === null || cell === undefined : cell === v;
        if (k === "in") return Array.isArray(v) && v.includes(cell);
        if (k === "lte") return typeof cell === "string" && typeof v === "string" && cell <= v;
        if (k === "gte") return typeof cell === "string" && typeof v === "string" && cell >= v;
        if (k === "lt") return typeof cell === "string" && typeof v === "string" && cell < v;
        return true;
      }),
    );
  }

  then(resolve: (v: { data: unknown; error: unknown; count?: number }) => unknown) {
    if (this.op === "insert") {
      const row = this.insertRow!;
      if (this.table === "notification_deliveries" && row.dedupe_key != null) {
        const key = `${row.user_id}|${row.dedupe_key}|${row.channel}`;
        const dup = (this.store[this.table] ?? []).some(
          (r) => `${r.user_id}|${r.dedupe_key}|${r.channel}` === key,
        );
        if (dup) return Promise.resolve({ data: null, error: { code: "23505", message: "dup" } }).then(resolve);
      }
      (this.store[this.table] ??= []).push(row);
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    if (this.op === "update") {
      this.rows().forEach((r) => Object.assign(r, this.patch));
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    const matched = this.rows();
    if (this.wantCount) return Promise.resolve({ data: null, error: null, count: matched.length }).then(resolve);
    if (this.single) return Promise.resolve({ data: matched[0] ?? null, error: null }).then(resolve);
    return Promise.resolve({ data: matched, error: null }).then(resolve);
  }
}

function fake(store: Store): SupabaseClient {
  return { from: (t: string) => new Query(store, t) } as unknown as SupabaseClient;
}

function baseStore(): Store {
  return {
    profiles: [{ id: "u1", timezone: "UTC" }],
    notification_preferences: [], // defaults → email
    notification_contacts: [
      { id: "e1", user_id: "u1", channel: "email", address: "me@x.com", verified_at: "2020-01-01T00:00:00Z", opted_out_at: null, is_primary: true, created_at: "2020-01-01T00:00:00Z" },
    ],
    notification_deliveries: [],
    reminders: [
      { id: "due", user_id: "u1", message: "Call the lab", remind_at: "2020-01-01T00:00:00Z", notification_type: "auto", urgent: false, completed_at: null, dispatched_at: null },
      { id: "future", user_id: "u1", message: "Later", remind_at: "2999-01-01T00:00:00Z", notification_type: "auto", urgent: false, completed_at: null, dispatched_at: null },
      { id: "inapp", user_id: "u1", message: "In-app only", remind_at: "2020-01-01T00:00:00Z", notification_type: "in_app", urgent: false, completed_at: null, dispatched_at: null },
      { id: "done", user_id: "u1", message: "Already done", remind_at: "2020-01-01T00:00:00Z", notification_type: "auto", urgent: false, completed_at: "2020-02-01T00:00:00Z", dispatched_at: null },
    ],
  };
}

describe("dispatchDueReminders", () => {
  it("dispatches only due, uncompleted, off-app reminders", async () => {
    const store = baseStore();
    const summary = await dispatchDueReminders(fake(store));

    expect(summary.dispatched).toBe(1); // only "due" — not future, in_app, or done
    expect(store.notification_deliveries).toHaveLength(1);
    expect(store.notification_deliveries[0]).toMatchObject({ kind: "reminder", channel: "email", dedupe_key: "reminder:due" });
    expect(store.reminders.find((r) => r.id === "due")!.dispatched_at).not.toBeNull();
  });

  it("is idempotent across two runs (dispatched_at skips it; dedupe backstops)", async () => {
    const store = baseStore();
    await dispatchDueReminders(fake(store));
    const secondSummary = await dispatchDueReminders(fake(store));
    expect(secondSummary.dispatched).toBe(0); // dispatched_at now set → not re-scanned
    expect(store.notification_deliveries).toHaveLength(1);

    // Even if the dispatched_at guard is lost, the delivery dedupe prevents a 2nd row.
    store.reminders.find((r) => r.id === "due")!.dispatched_at = null;
    const thirdSummary = await dispatchDueReminders(fake(store));
    expect(thirdSummary.dispatched).toBe(1); // re-scanned and re-enqueued...
    expect(store.notification_deliveries).toHaveLength(1); // ...but no new delivery (idempotent)
  });
});
