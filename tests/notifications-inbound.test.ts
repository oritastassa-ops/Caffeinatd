import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isAutomatedSender,
  processInbound,
  type InboundDeps,
  type InboundMessage,
} from "@/lib/notifications/inbound";
import { INBOUND_TOOLS, isInboundTool } from "@/lib/notifications/inbound-scope";
import { formatSmsReply } from "@/lib/notifications/inbound-reply";
import { executeToolCall } from "@/lib/pipeline/executor";
import { NotificationChannel } from "@/lib/notifications/types";
import type { AssistantResponse, Profile } from "@/lib/types";

/* ── An in-memory fake of just the query chains processInbound uses ─────────── */

interface Table {
  rows: Record<string, unknown>[];
  /** Columns whose combination must be unique (drives the dedupe 23505 path). */
  unique?: string[];
}

class FakeQuery {
  private op: "select" | "update" | "insert" = "select";
  private filters: [string, string, unknown][] = [];
  private patch: Record<string, unknown> = {};
  private pending: Record<string, unknown>[] = [];
  private countMode = false;

  constructor(
    private table: Table,
    private tableName: string,
    private rpcCalls: { name: string; args: unknown }[],
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    return this;
  }
  insert(row: Record<string, unknown> | Record<string, unknown>[]) {
    this.op = "insert";
    this.pending = Array.isArray(row) ? row : [row];
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
  is(col: string, val: unknown) {
    this.filters.push(["is", col, val]);
    return this;
  }
  not(col: string, _op: string, val: unknown) {
    this.filters.push(["not-is", col, val]);
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push(["gte", col, val]);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }

  private match(): Record<string, unknown>[] {
    return this.table.rows.filter((r) =>
      this.filters.every(([kind, col, val]) => {
        const cell = r[col];
        if (kind === "eq") return cell === val;
        if (kind === "is") return cell === val;
        if (kind === "not-is") return cell !== val;
        if (kind === "gte") return typeof cell === "string" && typeof val === "string" && cell >= val;
        return true;
      }),
    );
  }

  private run(): { data: unknown; error: unknown; count?: number } {
    if (this.op === "insert") {
      const out: Record<string, unknown>[] = [];
      for (const row of this.pending) {
        if (this.table.unique) {
          const clash = this.table.rows.some((r) => this.table.unique!.every((c) => r[c] === row[c]));
          if (clash) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const withId = { id: `${this.tableName}-${this.table.rows.length + 1}`, ...row };
        this.table.rows.push(withId);
        out.push(withId);
      }
      return { data: out, error: null };
    }
    if (this.op === "update") {
      for (const r of this.match()) Object.assign(r, this.patch);
      return { data: null, error: null };
    }
    const matched = this.match();
    if (this.countMode) return { data: null, error: null, count: matched.length };
    return { data: matched, error: null };
  }

  single() {
    const { data, error, count } = this.run();
    if (error) return Promise.resolve({ data: null, error });
    const arr = data as Record<string, unknown>[] | null;
    return Promise.resolve({ data: arr?.[0] ?? null, error: null, count });
  }
  maybeSingle() {
    return this.single();
  }
  then(resolve: (v: { data: unknown; error: unknown; count?: number }) => unknown) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

/** Typed table accessor — index access on the seed map is possibly-undefined. */
function tbl(tables: Record<string, Table>, name: string): Record<string, unknown>[] {
  const table = tables[name];
  if (!table) throw new Error(`no such table: ${name}`);
  return table.rows;
}

function fakeSupabase(seed: Record<string, Table>) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const tables = seed;
  const client = {
    from(name: string) {
      tables[name] ??= { rows: [] };
      return new FakeQuery(tables[name], name, rpcCalls);
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, tables, rpcCalls };
}

/* ── Fixtures ────────────────────────────────────────────────────────────────── */

const PROFILE: Profile = { id: "user-1", display_name: "Ori", timezone: "America/Toronto", settings: {}, onboarded_at: null };

function baseTables(contactOverrides: Record<string, unknown>[] = []): Record<string, Table> {
  return {
    inbound_messages: { rows: [], unique: ["channel", "provider_message_id"] },
    notification_contacts: {
      rows: contactOverrides.length
        ? contactOverrides
        : [{ id: "contact-1", user_id: "user-1", address: "+15551234567", channel: "sms", verified_at: "2026-01-01T00:00:00Z", opted_out_at: null }],
    },
    notification_deliveries: { rows: [] },
    profiles: { rows: [{ id: "user-1", display_name: "Ori", timezone: "America/Toronto", settings: {}, onboarded_at: null }] },
    ai_conversations: { rows: [] },
  };
}

const fakeChannel: NotificationChannel = {
  name: "sms",
  normalizeAddress: (raw) => ({ ok: true, address: raw }),
  send: vi.fn(async () => ({ ok: true, providerMessageId: "SM-reply", retryable: false })),
};

function deps(supabase: SupabaseClient, assistant: InboundDeps["runAssistant"]): InboundDeps {
  return {
    supabase,
    provider: { name: "fake", chat: vi.fn() } as never,
    getChannel: () => fakeChannel,
    runAssistant: assistant,
    now: () => new Date("2026-07-29T12:00:00Z"),
  };
}

const SMS: InboundMessage = { channel: "sms", providerMessageId: "SM-1", from: "+15551234567", body: "add milk to my list" };

const okAssistant = vi.fn(
  async (): Promise<AssistantResponse> => ({ text: "Added milk to Groceries.", actions: [], failures: [] }),
);

/* ── Tool scoping ────────────────────────────────────────────────────────────── */

describe("inbound tool scope", () => {
  it("excludes destructive/interactive tools and keeps the reversible core", () => {
    expect(INBOUND_TOOLS.has("delete_event")).toBe(false);
    expect(INBOUND_TOOLS.has("suggest_memory")).toBe(false);
    expect(INBOUND_TOOLS.has("update_event")).toBe(true); // "move gym to 6"
    expect(INBOUND_TOOLS.has("create_task")).toBe(true);
    expect(isInboundTool("delete_event")).toBe(false);
    expect(isInboundTool("create_task")).toBe(true);
  });

  it("refuses an out-of-scope tool at the executor with a legible message, before any DB call", async () => {
    const supabase = { from: () => { throw new Error("must not touch the DB"); } } as unknown as SupabaseClient;
    const outcome = await executeToolCall(
      { supabase, provider: {} as never, profile: PROFILE, allowedTools: INBOUND_TOOLS },
      { id: "1", name: "delete_event", arguments: { event_id: "abc" } },
    );
    expect(outcome.result).toMatch(/^Error:/);
    expect(outcome.result).toMatch(/isn't available by text or email/);
    expect(outcome.receipt).toBeUndefined();
  });
});

/* ── Reply formatting ────────────────────────────────────────────────────────── */

describe("formatSmsReply", () => {
  it("passes a short reply through untouched", () => {
    const r = formatSmsReply("Added milk to Groceries.");
    expect(r.truncated).toBe(false);
    expect(r.body).toBe("Added milk to Groceries.");
  });

  it("truncates a long reply on a word boundary with a pointer", () => {
    const long = "word ".repeat(120).trim();
    const r = formatSmsReply(long);
    expect(r.truncated).toBe(true);
    expect(r.body.endsWith("open the app for the rest")).toBe(true);
    expect(r.body.length).toBeLessThanOrEqual(306); // <= 2 GSM segments
    expect(r.body).not.toMatch(/wor$/); // no mid-word slice
  });

  it("uses the smaller UCS-2 budget when a non-GSM character is present", () => {
    const text = "🚀 " + "a".repeat(200);
    const r = formatSmsReply(text, 1);
    expect(r.truncated).toBe(true);
    expect([...r.body].length).toBeLessThanOrEqual(70);
  });
});

/* ── Automated-sender guard ──────────────────────────────────────────────────── */

describe("isAutomatedSender", () => {
  it("flags auto-submitted, bulk precedence, and list headers", () => {
    expect(isAutomatedSender({ "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(isAutomatedSender({ Precedence: "bulk" })).toBe(true);
    expect(isAutomatedSender({ "List-Id": "<news.example.com>" })).toBe(true);
    expect(isAutomatedSender({ "List-Unsubscribe": "<https://x>" })).toBe(true);
  });
  it("passes a normal human reply", () => {
    expect(isAutomatedSender({ "Auto-Submitted": "no" })).toBe(false);
    expect(isAutomatedSender(undefined)).toBe(false);
    expect(isAutomatedSender({ Subject: "Re: your plan" })).toBe(false);
  });
});

/* ── Pipeline guard paths (the security-critical assertions) ─────────────────── */

describe("processInbound — guards run before any AI call", () => {
  it("drops an unknown/unverified sender, leaves an audit row, never calls the assistant", async () => {
    const { client, tables } = fakeSupabase(baseTables([])); // no contacts
    const assistant = vi.fn();
    const res = await processInbound(deps(client, assistant as never), { ...SMS, from: "+19998887777" });
    expect(res.status).toBe("rejected");
    expect(assistant).not.toHaveBeenCalled();
    expect(tbl(tables, "inbound_messages")).toHaveLength(1);
    expect(tbl(tables, "inbound_messages")[0]).toMatchObject({ status: "rejected", error: "unknown or unverified sender" });
  });

  it("refuses an address that resolves to more than one user", async () => {
    const { client, tables } = fakeSupabase(
      baseTables([
        { id: "c-a", user_id: "user-1", address: "+15551234567", channel: "sms", verified_at: "2026-01-01T00:00:00Z", opted_out_at: null },
        { id: "c-b", user_id: "user-2", address: "+15551234567", channel: "sms", verified_at: "2026-01-01T00:00:00Z", opted_out_at: null },
      ]),
    );
    const assistant = vi.fn();
    const res = await processInbound(deps(client, assistant as never), SMS);
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("ambiguous sender identity");
    expect(assistant).not.toHaveBeenCalled();
    expect((tbl(tables, "inbound_messages")[0] ?? {}).error).toMatch(/ambiguous/);
  });

  it("rate-limits before the AI call once the per-minute threshold is exceeded", async () => {
    const tables = baseTables();
    // Pre-seed enough recent inbound rows for this contact to trip the minute cap.
    for (let i = 0; i < 5; i++) {
      tbl(tables, "inbound_messages").push({
        id: `pre-${i}`, contact_id: "contact-1", channel: "sms", provider_message_id: `old-${i}`, created_at: "2026-07-29T11:59:40Z",
      });
    }
    const { client } = fakeSupabase(tables);
    const assistant = vi.fn();
    const res = await processInbound(deps(client, assistant as never), SMS);
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("rate limited");
    expect(assistant).not.toHaveBeenCalled();
  });

  it("treats a duplicate provider_message_id as a no-op", async () => {
    const tables = baseTables();
    tbl(tables, "inbound_messages").push({ id: "existing", channel: "sms", provider_message_id: "SM-1" });
    const { client } = fakeSupabase(tables);
    const assistant = vi.fn();
    const res = await processInbound(deps(client, assistant as never), SMS);
    expect(res.status).toBe("duplicate");
    expect(assistant).not.toHaveBeenCalled();
    expect(tbl(tables, "inbound_messages")).toHaveLength(1); // no second row
  });

  it("drops an automated sender (auto-reply loop guard)", async () => {
    const { client, tables } = fakeSupabase(baseTables());
    const assistant = vi.fn();
    const res = await processInbound(deps(client, assistant as never), {
      ...SMS,
      headers: { "Auto-Submitted": "auto-replied" },
    });
    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("automated sender");
    expect(assistant).not.toHaveBeenCalled();
    expect((tbl(tables, "inbound_messages")[0] ?? {}).error).toBe("automated sender");
  });
});

describe("processInbound — happy path", () => {
  it("runs the scoped assistant, replies via the channel, and records the exchange", async () => {
    const { client, tables, rpcCalls } = fakeSupabase(baseTables());
    (fakeChannel.send as ReturnType<typeof vi.fn>).mockClear();
    const res = await processInbound(deps(client, okAssistant as never), SMS);

    expect(res.status).toBe("processed");
    // Assistant was called with the INBOUND-scoped tool set.
    expect(okAssistant).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: "user-1" }),
      "add milk to my list",
      { allowedTools: INBOUND_TOOLS },
    );
    // A reply left the channel and was logged + counted.
    expect(fakeChannel.send).toHaveBeenCalledTimes(1);
    expect(tbl(tables, "inbound_messages")[0]).toMatchObject({ status: "processed", user_id: "user-1" });
    expect(tbl(tables, "notification_deliveries").some((r) => r.kind === "system")).toBe(true);
    expect(rpcCalls.some((c) => c.name === "increment_notification_spend")).toBe(true);
  });
});
