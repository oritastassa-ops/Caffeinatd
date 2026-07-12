"use client";

import { useSyncExternalStore } from "react";
import { AssistantResponse } from "@/lib/types";

/**
 * The assistant request lifecycle, as a tiny module-level store. The command
 * palette *submits* here and closes; the floating companion *subscribes* and
 * performs — so an AI request never blocks the app. No context provider
 * needed: both live in the same client bundle.
 *
 * Phases: sleeping → waking (0.5s) → brewing (coffee ritual, ~1.4s) →
 * thinking (until the API answers, min total 2.2s so the ritual always
 * completes) → responding | error → sleeping.
 */

export type CompanionPhase =
  | "sleeping"
  | "waking"
  | "brewing"
  | "thinking"
  | "responding"
  | "error";

export interface AssistantUIState {
  phase: CompanionPhase;
  /** The prompt currently in flight (or last answered). */
  prompt: string | null;
  response: AssistantResponse | null;
  error: string | null;
  /** A finished response the user hasn't opened or dismissed yet. */
  unread: boolean;
  /** Whether the bubble is expanded beside the character. */
  bubbleOpen: boolean;
}

const WAKE_MS = 500;
const BREW_MS = 1400;
/** Never reveal a result before the wake + coffee ritual has played. */
const MIN_CEREMONY_MS = WAKE_MS + BREW_MS + 300;

let state: AssistantUIState = {
  phase: "sleeping",
  prompt: null,
  response: null,
  error: null,
  unread: false,
  bubbleOpen: false,
};

const listeners = new Set<() => void>();
/** Invalidates in-flight choreography timers when a new request starts. */
let requestToken = 0;

function set(patch: Partial<AssistantUIState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAssistantState(): AssistantUIState {
  return state;
}

/** React binding — re-renders on every store change. */
export function useAssistant(): AssistantUIState {
  return useSyncExternalStore(subscribe, getAssistantState, getAssistantState);
}

export function isBusy(): boolean {
  return state.phase === "waking" || state.phase === "brewing" || state.phase === "thinking";
}

/**
 * Fire one assistant request with the full wake choreography.
 * Returns false (and does nothing) if a request is already in flight.
 */
export function askAssistant(message: string): boolean {
  if (isBusy()) return false;
  const token = ++requestToken;
  const startedAt = Date.now();

  set({
    phase: "waking",
    prompt: message,
    response: null,
    error: null,
    unread: false,
    bubbleOpen: false,
  });

  const still = () => token === requestToken;
  setTimeout(() => still() && state.phase === "waking" && set({ phase: "brewing" }), WAKE_MS);
  setTimeout(
    () => still() && state.phase === "brewing" && set({ phase: "thinking", bubbleOpen: true }),
    WAKE_MS + BREW_MS,
  );

  void (async () => {
    let response: AssistantResponse | null = null;
    let error: string | null = null;
    try {
      // Backstop above the server's own budget: the companion must never
      // sit in "thinking" forever if the connection wedges.
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      response = data as AssistantResponse;
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong";
    }
    if (!still()) return;

    // Let the ceremony finish even when the model is fast.
    const wait = Math.max(0, MIN_CEREMONY_MS - (Date.now() - startedAt));
    setTimeout(() => {
      if (!still()) return;
      if (error) set({ phase: "error", error, bubbleOpen: true, unread: true });
      else set({ phase: "responding", response, bubbleOpen: true, unread: true });
    }, wait);
  })();

  return true;
}

/** Collapse the bubble but keep the response retrievable (notification dot). */
export function minimizeBubble() {
  set({ bubbleOpen: false });
}

/** Re-expand the last response. */
export function reopenBubble() {
  if (state.response || state.error) set({ bubbleOpen: true, unread: false });
}

/** Mark the current response as seen (dot disappears, bubble stays). */
export function markRead() {
  if (state.unread) set({ unread: false });
}

/** Dismiss the response entirely — the companion goes back to sleep. */
export function dismissResponse() {
  requestToken++;
  set({
    phase: "sleeping",
    prompt: null,
    response: null,
    error: null,
    unread: false,
    bubbleOpen: false,
  });
}
