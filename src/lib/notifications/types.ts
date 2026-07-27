/**
 * Provider-agnostic notification contracts. Everything above the channel layer
 * (enqueue, the Phase 4 dispatcher, the pillars) depends only on this file —
 * never on Resend, Twilio, or a channel name. Mirrors the two existing
 * abstraction patterns in the repo: AIProvider (src/lib/ai/types.ts) and
 * FitnessProviderClient (src/lib/integrations/types.ts).
 */

export type NotificationChannelName = "email" | "sms";

/** The pillars that can notify. Preferences and deliveries are keyed by this. */
export const NOTIFICATION_KINDS = [
  "daily_plan",
  "reminder",
  "insight",
  "finance_review",
  "fitness_nudge",
  "system",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface SendRequest {
  to: string; // verified address (normalized)
  subject?: string; // email only; SMS ignores
  body: string; // plain text, always present
  html?: string; // email only
  idempotencyKey: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  /** Safe, user-facing. Never the provider's raw error body. */
  error?: string;
  retryable: boolean;
}

/** Result of validating + normalizing a destination before it is stored. */
export type NormalizeResult =
  | { ok: true; address: string }
  | { ok: false; error: string };

export interface NotificationChannel {
  readonly name: NotificationChannelName;
  send(req: SendRequest): Promise<SendResult>;
  /** Validate + normalize a destination before it is ever stored. */
  normalizeAddress(raw: string): NormalizeResult;
}
