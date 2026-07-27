import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The worker signs an unsubscribe link per delivery, which needs the secret.
process.env.NOTIFICATION_SECRET = "test-pepper-not-a-real-secret";

import { runWorker } from "@/lib/notifications/worker";
import { backoffMs } from "@/lib/notifications/backoff";
import { NotificationChannel, SendResult } from "@/lib/notifications/types";

interface Row {
  id: string;
  user_id: string;
  kind: string;
  channel: string;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  attempts: number;
  status: string;
  scheduled_for: string;
  sent_at?: string | null;
  provider_message_id?: string | null;
  last_error?: string | null;
  contact: { address: string } | null;
}

type Filter = ["eq" | "lte", string, unknown];

/** Minimal fake of the exact query chains runWorker uses, over an in-memory store. */
class Query {
  private op: "select" | "update" = "select";
  private filters: Filter[] = [];
  private patch: Record<string, unknown> = {};
  private returnSelect = false;
  constructor(private rows: Row[]) {}

  select() {
    if (this.op !== "update") this.op = "select";
    else this.returnSelect = true;
    return this;
  }
  update(patch: Record<string, unknown>) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push(["eq", col, val]);
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push(["lte", col, val]);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  private match(): Row[] {
    return this.rows.filter((r) =>
      this.filters.every(([kind, col, val]) => {
        const cell = (r as unknown as Record<string, unknown>)[col];
        if (kind === "eq") return cell === val;
        return typeof cell === "string" && typeof val === "string" && cell <= val;
      }),
    );
  }
  then(resolve: (v: { data: unknown; error: null }) => unknown) {
    const matched = this.match();
    if (this.op === "update") {
      matched.forEach((r) => Object.assign(r, this.patch));
      return Promise.resolve({ data: this.returnSelect ? matched.map((r) => ({ id: r.id })) : null, error: null }).then(resolve);
    }
    const sorted = [...matched].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
    return Promise.resolve({ data: sorted, error: null }).then(resolve);
  }
}

function fakeSupabase(rows: Row[]): SupabaseClient {
  return { from: () => new Query(rows) } as unknown as SupabaseClient;
}

function scriptedChannel(results: SendResult[]): NotificationChannel {
  const send = vi.fn();
  results.forEach((r) => send.mockResolvedValueOnce(r));
  return {
    name: "email",
    send,
    normalizeAddress: (raw: string) => ({ ok: true, address: raw }),
  };
}

function pendingRow(over: Partial<Row> = {}): Row {
  return {
    id: "d1",
    user_id: "u1",
    kind: "reminder",
    channel: "email",
    payload: { message: "call mom" },
    dedupe_key: "reminder:1",
    attempts: 0,
    status: "pending",
    scheduled_for: "2026-07-27T11:50:00.000Z",
    contact: { address: "me@example.com" },
    ...over,
  };
}

const deps = (channel: NotificationChannel, now: Date) => ({
  getChannel: () => channel,
  batchSize: 50,
  leaseMs: 10 * 60_000,
  appUrl: "https://app.test",
  now: () => now,
});

const RETRYABLE: SendResult = { ok: false, retryable: true, error: "busy" };
const OK: SendResult = { ok: true, retryable: false, providerMessageId: "prov_1" };
const PERMANENT: SendResult = { ok: false, retryable: false, error: "bad address" };

describe("runWorker", () => {
  it("retries a retryable failure with backoff, then sends on a later tick", async () => {
    const rows = [pendingRow()];
    const channel = scriptedChannel([RETRYABLE, OK]);

    const t1 = new Date("2026-07-27T12:00:00.000Z");
    const s1 = await runWorker(fakeSupabase(rows), deps(channel, t1));
    expect(s1).toMatchObject({ claimed: 1, retried: 1, sent: 0 });
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempts).toBe(1);
    // pushed out by the 1m backoff before the 2nd attempt
    expect(rows[0]!.scheduled_for).toBe(new Date(t1.getTime() + backoffMs(2)).toISOString());

    // Too soon: still leased into the future, nothing to do.
    const s2 = await runWorker(fakeSupabase(rows), deps(channel, new Date(t1.getTime() + 30_000)));
    expect(s2).toMatchObject({ claimed: 0, sent: 0 });

    // After the backoff elapses it becomes claimable and succeeds.
    const t3 = new Date(t1.getTime() + 2 * 60_000);
    const s3 = await runWorker(fakeSupabase(rows), deps(channel, t3));
    expect(s3).toMatchObject({ claimed: 1, sent: 1 });
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.provider_message_id).toBe("prov_1");
  });

  it("fails a non-retryable send immediately", async () => {
    const rows = [pendingRow()];
    const channel = scriptedChannel([PERMANENT]);
    const s = await runWorker(fakeSupabase(rows), deps(channel, new Date("2026-07-27T12:00:00.000Z")));
    expect(s).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.last_error).toBe("bad address");
  });

  it("sends nothing on a second drain once the row is sent (idempotent at rest)", async () => {
    const rows = [pendingRow()];
    const channel = scriptedChannel([OK, OK]);
    const now = new Date("2026-07-27T12:00:00.000Z");

    const first = await runWorker(fakeSupabase(rows), deps(channel, now));
    expect(first.sent).toBe(1);

    const second = await runWorker(fakeSupabase(rows), deps(channel, now));
    expect(second).toMatchObject({ claimed: 0, sent: 0 });
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("fails a row whose channel isn't configured", async () => {
    const rows = [pendingRow()];
    const s = await runWorker(fakeSupabase(rows), {
      getChannel: () => null,
      batchSize: 50,
      leaseMs: 10 * 60_000,
      appUrl: "https://app.test",
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });
    expect(s).toMatchObject({ claimed: 1, failed: 1 });
    expect(rows[0]!.status).toBe("failed");
  });
});
