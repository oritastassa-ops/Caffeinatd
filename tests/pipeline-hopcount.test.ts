import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIProvider, ChatRequest, ChatResult } from "@/lib/ai/types";
import { Profile } from "@/lib/types";

/**
 * The phase's headline regression guard: with the situation brief present, the
 * everyday "about today" questions must resolve in ONE model call — no tool hop.
 * A hop is a full round trip carrying ~3,800 tokens of tool schemas, so removing
 * it is the whole latency win. If a future change stops injecting the brief (or
 * drops the calendar from it), the scripted provider below will spend a
 * get_agenda hop again and these assertions fail.
 *
 * We can't measure wall-clock without live keys, but HOP COUNT is deterministic
 * and provider-independent — so it lives here permanently instead of in a
 * one-off benchmark.
 */

// The brief is toggled per run to measure before/after Part A on identical data.
// Its CONTENT is guarded by tests/pipeline-context.test.ts; here we only care
// that runAssistant injects it and that its presence collapses the hop.
const h = vi.hoisted(() => ({
  enabled: true,
  BRIEF: [
    "Today: Wednesday 2026-07-29 (America/Toronto). Readiness 100/100 — Nothing pulling your day off track right now.",
    "Today's plan: A busy but doable day. Priorities: Submit lab report; Email Dr. Chen.",
    "Calendar today: 9:00 AM–9:30 AM Standup; 2:00 PM–3:00 PM Dentist.",
    "Open tasks: [P1] Submit lab report; [P2] Email Dr. Chen.",
  ].join("\n"),
}));

vi.mock("@/lib/pipeline/context", () => ({
  buildSituationBrief: async () => (h.enabled ? h.BRIEF : ""),
}));

// Keep the real calendar module (encodeEventKey etc.) but stub the network read.
vi.mock("@/lib/google/calendar", async (orig) => ({
  ...(await orig()),
  listEvents: async () => [],
}));
vi.mock("@/lib/google/oauth", async (orig) => ({
  ...(await orig()),
  getAccessToken: async () => "fake-token",
}));

import { runAssistant } from "@/lib/pipeline/run";

/** A provider that acts like a competent model: if the answer is already in the
 *  system prompt it replies directly (0 tool calls); otherwise it spends one
 *  tool hop to fetch it, then answers. Counts its own invocations = hops. */
class ScriptedProvider implements AIProvider {
  readonly name = "scripted";
  chatCount = 0;
  lastSystem = "";
  constructor(
    private readonly marker: string,
    private readonly toolIfMissing: string,
  ) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.chatCount += 1;
    this.lastSystem = req.messages.find((m) => m.role === "system")?.content ?? "";
    if (this.lastSystem.includes(this.marker)) {
      return { text: "Here's your day.", toolCalls: [] };
    }
    if (this.chatCount === 1) {
      return { text: "", toolCalls: [{ id: "call-1", name: this.toolIfMissing, arguments: {} }] };
    }
    return { text: "Here's your day.", toolCalls: [] };
  }
}

/** Fake DB: every table resolves to empty rows; filters are no-ops. Enough for
 *  recallMemories/reachableChannels (→ []) and list_tasks (→ "No tasks."). */
function fakeDb(): SupabaseClient {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gte", "order", "limit", "not"]) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (res: (v: { data: unknown[]; error: null; count: number }) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(res);
  return { from: () => b } as unknown as SupabaseClient;
}

const profile: Profile = { id: "u1", display_name: "Ori", timezone: "America/Toronto", settings: {}, onboarded_at: null };

const PROMPTS = [
  { q: "What's on my calendar today?", marker: "Calendar today:", tool: "get_agenda" },
  { q: "What does my day look like?", marker: "Today's plan:", tool: "get_agenda" },
  { q: "Am I free at 3pm?", marker: "Calendar today:", tool: "get_agenda" },
  { q: "What should I focus on today?", marker: "Open tasks:", tool: "list_tasks" },
  { q: "I have a free hour — what should I do?", marker: "Open tasks:", tool: "list_tasks" },
];

async function hopsFor(prompt: (typeof PROMPTS)[number]): Promise<{ hops: number; system: string }> {
  const provider = new ScriptedProvider(prompt.marker, prompt.tool);
  await runAssistant(fakeDb(), provider, profile, prompt.q);
  return { hops: provider.chatCount, system: provider.lastSystem };
}

describe("assistant hop count — before/after the situation brief", () => {
  it("collapses every everyday 'today' question from 2 hops to 1", async () => {
    const table: Record<string, { before: number; after: number }> = {};
    for (const p of PROMPTS) {
      h.enabled = false;
      const before = (await hopsFor(p)).hops;
      h.enabled = true;
      const after = (await hopsFor(p)).hops;
      table[p.q] = { before, after };
      expect(before).toBe(2); // no context → one tool hop + one answer
      expect(after).toBe(1); // brief present → answered directly
    }
    // Printed for the commit body.
    console.log("\n===== HOP COUNT (deterministic) =====");
    for (const [q, { before, after }] of Object.entries(table)) {
      console.log(`${before} → ${after}   ${q}`);
    }
    console.log("=====================================\n");
  });

  it("PERMANENT GUARD: 'what's on my calendar today' takes exactly one hop, and the brief is in the prompt", async () => {
    h.enabled = true;
    const { hops, system } = await hopsFor(PROMPTS[0]!);
    expect(hops).toBe(1); // zero tool calls
    // The reason it's one hop: runAssistant actually injected the calendar.
    expect(system).toContain("Calendar today:");
  });

  it("without the brief, the same question regresses to a tool hop (the failure mode we guard against)", async () => {
    h.enabled = false;
    const { hops } = await hopsFor(PROMPTS[0]!);
    expect(hops).toBe(2);
  });
});
