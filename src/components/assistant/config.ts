import { CommunicationStyle } from "@/lib/types";

/**
 * Frontend-only companion voice lines, keyed by personality. These decorate
 * the UI choreography (thinking bubbles, error empathy) — the actual reply
 * text always comes from the AI pipeline. Kept separate from
 * lib/personalities.ts, which feeds the system prompt.
 */
export interface CompanionVoice {
  /** Shown with typing dots while the request is processing. */
  thinking: string;
  /** Shown above the error detail when a request fails. */
  error: string;
}

export const COMPANION_VOICE: Record<CommunicationStyle, CompanionVoice> = {
  supportive: {
    thinking: "Let me take care of that for you ☕",
    error: "Oh no — that didn't go through. Let's try again together.",
  },
  analytical: {
    thinking: "Analyzing your data and finding the optimal path…",
    error: "The request failed. Here's the diagnostic:",
  },
  coaching: {
    thinking: "On it — let's build the best plan forward.",
    error: "Small setback, big comeback. Here's what happened:",
  },
  casual: {
    thinking: "Got it. Give me a sec ☕",
    error: "Hm, that one spilled. Details:",
  },
};
