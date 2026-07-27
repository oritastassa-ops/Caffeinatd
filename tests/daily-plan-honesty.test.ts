import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProvider } from "@/lib/ai/types";
import type { Profile } from "@/lib/types";

// Isolate generateDailyPlan from its integration surface so the test targets
// exactly the honesty fixes (docs/12 §A1/§A2): a failed upsert must throw, and
// unparseable model output must throw — neither may report a phantom success.
vi.mock("@/lib/integrations/hevy", () => ({ syncIfStale: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/google/oauth", () => ({ getAccessToken: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/google/calendar", () => ({ listEvents: vi.fn(), createEvent: vi.fn() }));
vi.mock("@/lib/fitness/refresh", () => ({ fetchSetRows: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/home/data", () => ({ fetchHomeData: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/fitness/recovery", () => ({ computeMuscleRecovery: vi.fn().mockReturnValue({}) }));
vi.mock("@/lib/fitness/programs", () => ({
  getProgram: vi.fn().mockReturnValue(null),
  recommendProgramSession: vi.fn().mockReturnValue({ label: "Rest", reason: "test" }),
}));

import { generateDailyPlan } from "@/lib/planning/daily";

const profile: Profile = {
  id: "u1",
  display_name: "Ori",
  timezone: "UTC",
  settings: {},
  onboarded_at: null,
};

const VALID_PLAN = JSON.stringify({
  overview: "A calm, focused day.",
  priorities: ["Ship Phase 2"],
  workout: "Push day",
  nutrition: "Hit protein",
  freeWindows: ["14:00–16:00"],
});

function provider(text: string): AIProvider {
  return { name: "fake", chat: vi.fn().mockResolvedValue({ text, toolCalls: [] }) };
}

/** A chainable, thenable query builder; upsert resolves to an injectable error. */
function fakeSupabase(upsertError: { message: string } | null): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "is", "order", "gte", "eq", "limit", "maybeSingle"]) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  builder.upsert = () => ({
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: upsertError }).then(resolve),
  });
  builder.insert = () => ({
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  });
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("generateDailyPlan honesty (A1/A2)", () => {
  it("A1: throws when the daily_plans upsert fails instead of reporting success", async () => {
    const supabase = fakeSupabase({ message: "RLS: new row violates policy" });
    await expect(generateDailyPlan(supabase, provider(VALID_PLAN), profile)).rejects.toThrow(
      /could not be saved/i,
    );
  });

  it("A2: throws on unparseable model output instead of saving a hollow plan", async () => {
    const supabase = fakeSupabase(null); // upsert would succeed; we must not reach it
    await expect(
      generateDailyPlan(supabase, provider("here is your plan: (definitely not json)"), profile),
    ).rejects.toThrow(/couldn't read/i);
  });

  it("returns the plan when parsing and the upsert both succeed", async () => {
    const supabase = fakeSupabase(null);
    const result = await generateDailyPlan(supabase, provider(VALID_PLAN), profile);
    expect(result.plan.priorities).toEqual(["Ship Phase 2"]);
    expect(result.plan.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
