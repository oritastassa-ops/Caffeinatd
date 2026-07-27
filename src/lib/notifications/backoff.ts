import { SendResult } from "./types";

/**
 * Retry schedule for a failed delivery. Pure so the sequence and cap are
 * asserted in a unit test rather than discovered in production. A message gets
 * MAX_ATTEMPTS send tries; between them `scheduled_for` is pushed out by the
 * delay for the attempt about to be waited on.
 *
 * Schedule (delay before attempt N): 1m, 5m, 25m, 2h, then capped at 2h.
 */
export const MAX_ATTEMPTS = 5;

const SCHEDULE_MS = [
  60_000, // → attempt 2 (after the 1st failure)
  5 * 60_000, // → attempt 3
  25 * 60_000, // → attempt 4
  2 * 60 * 60_000, // → attempt 5
];
const CAP_MS = 2 * 60 * 60_000;

/**
 * Delay before the send attempt numbered `attempt` (1-based). `attempt` 1 is
 * the first send and has no wait; 2+ index the schedule, capped.
 */
export function backoffMs(attempt: number): number {
  if (attempt <= 1) return 0;
  const idx = attempt - 2;
  return idx < SCHEDULE_MS.length ? SCHEDULE_MS[idx]! : CAP_MS;
}

export interface DeliveryOutcome {
  status: "sent" | "pending" | "failed";
  /** Total attempts made so far (including the one just resolved). */
  attempts: number;
  /** For a retry (`pending`), ms to add to now for the next `scheduled_for`. */
  retryDelayMs?: number;
}

/**
 * Given the current attempt count and a send result, decide the next state.
 * `priorAttempts` is the row's `attempts` before this send; this send is
 * therefore attempt `priorAttempts + 1`.
 *
 * - success → sent.
 * - retryable failure with attempts left → pending, backed off.
 * - non-retryable failure, or the last attempt exhausted → failed.
 */
export function resolveOutcome(result: SendResult, priorAttempts: number): DeliveryOutcome {
  const attempts = priorAttempts + 1;
  if (result.ok) return { status: "sent", attempts };
  if (result.retryable && attempts < MAX_ATTEMPTS) {
    return { status: "pending", attempts, retryDelayMs: backoffMs(attempts + 1) };
  }
  return { status: "failed", attempts };
}
