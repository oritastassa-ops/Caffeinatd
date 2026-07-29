import { describe, it } from "vitest";
import { getServiceClient } from "@/lib/supabase/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { getProvider } from "@/lib/ai";
import { loadProfile, runAssistant } from "@/lib/pipeline/run";
import { AIProvider, ChatRequest, ChatResult } from "@/lib/ai/types";

/**
 * LIVE latency + hop harness. Unlike tests/pipeline-hopcount.test.ts (which is
 * deterministic and always runs), this one hits the real Gemini + Supabase and
 * so is GATED behind an env flag — it is skipped by the normal suite.
 *
 * Run it locally:
 *
 *   LIVE_LATENCY=1 LATENCY_USER_ID=<your-user-uuid> \
 *     npx vitest run tests/assistant-latency.harness.test.ts
 *
 * (LATENCY_USER_ID is optional — it defaults to the first profile in the DB.)
 * It prints wall-clock ms and hop count for five representative prompts. Paste
 * the output into the "Real-world latency" section of docs/21-assistant-context.md.
 *
 * Why a gated test rather than a standalone script: this repo has no tsx/ts-node,
 * but vitest already resolves the TS + "@/" alias, so a gated test file is the
 * one-file, zero-setup way to run real pipeline code. It sends your prompts and
 * data to the live provider — that's why it never runs unattended.
 */

const PROMPTS = [
  "What's on my calendar today?",
  "What does my day look like?",
  "Am I free at 3pm?",
  "What should I focus on today?",
  "I have a free hour — what should I do?",
];

/** Wrap any provider to count chat() round trips (= hops). */
function countingProvider(inner: AIProvider): AIProvider & { hops: number } {
  const wrapper = {
    hops: 0,
    name: inner.name,
    async chat(req: ChatRequest): Promise<ChatResult> {
      wrapper.hops += 1;
      return inner.chat(req);
    },
    embed: inner.embed?.bind(inner),
  };
  return wrapper;
}

describe.runIf(process.env.LIVE_LATENCY === "1")("live assistant latency", () => {
  it("measures wall-clock + hops for five prompts", async () => {
    const supabase = getServiceClient();
    let userId = process.env.LATENCY_USER_ID;
    if (!userId) {
      const { data } = await supabase.from("profiles").select("id").limit(1).maybeSingle<{ id: string }>();
      if (!data) throw new Error("No profile found — set LATENCY_USER_ID.");
      userId = data.id;
    }
    const scoped = scopedClient(supabase, userId);
    const profile = await loadProfile(supabase, userId);

    console.log(`\n===== LIVE LATENCY (user ${userId}) =====`);
    console.log("hops | ms    | prompt");
    for (const prompt of PROMPTS) {
      const provider = countingProvider(getProvider());
      const t0 = performance.now();
      await runAssistant(scoped, provider, profile, prompt);
      const ms = Math.round(performance.now() - t0);
      console.log(`${String(provider.hops).padStart(4)} | ${String(ms).padStart(5)} | ${prompt}`);
    }
    console.log("=========================================\n");
  }, 120_000);
});
