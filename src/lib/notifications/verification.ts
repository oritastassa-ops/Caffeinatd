import crypto from "node:crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { hexEqual, hmacHex } from "./crypto";
import { getChannel } from "./registry";
import { renderVerificationCode } from "./templates/verification-code";
import { NotificationChannelName } from "./types";

/**
 * Contact verification, shared by email (Phase 2) and SMS (Phase 3). A 6-digit
 * code is generated, only its hash is stored, it expires in 10 minutes, and 5
 * wrong guesses kill it — after that the code is dead and must be re-requested.
 *
 * Hashing choice: HMAC-SHA256 with a server-side secret, NOT a bare SHA-256.
 * A 6-digit code is a 10^6 space — a plain hash is brute-forced instantly if the
 * database leaks. Keying the hash with a secret the DB doesn't contain means a
 * DB-only compromise can't reverse it. We don't need a slow KDF (bcrypt/scrypt)
 * here because the 5-attempt + 10-minute limits already defeat online guessing,
 * and a fast HMAC keeps the verify path cheap. The tradeoff: an attacker with
 * BOTH the DB and the app secret is back to brute-forcing 10^6 — acceptable, and
 * documented in docs/14.
 */

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // one code request per contact per minute

/** A zero-padded 6-digit code from a CSPRNG (crypto.randomInt is unbiased). */
export function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Keyed hash of a code — this, never the code, is what gets stored. */
export function hashCode(code: string): string {
  return hmacHex(code);
}

/** Constant-time compare of two hex digests (avoids a length/timing leak). */
export function hashesEqual(a: string, b: string): boolean {
  return hexEqual(a, b);
}

export type CheckOutcome = "ok" | "expired" | "exhausted" | "mismatch" | "no_code";

export interface StoredCode {
  hash: string | null;
  expiresAt: string | null;
  attempts: number;
}

/**
 * Pure verdict for a submitted code against stored state. No DB, no side
 * effects — the route persists the attempt increment based on this. Order
 * matters: an exhausted or expired code is rejected before the hash is ever
 * compared, so a dead code can't be brute-forced past its attempt budget.
 */
export function checkCode(stored: StoredCode, submitted: string, now: Date): CheckOutcome {
  if (!stored.hash || !stored.expiresAt) return "no_code";
  if (stored.attempts >= MAX_ATTEMPTS) return "exhausted";
  if (now.getTime() > new Date(stored.expiresAt).getTime()) return "expired";
  return hashesEqual(hashCode(submitted), stored.hash) ? "ok" : "mismatch";
}

/** True when a new code may be sent (cooldown elapsed / never sent). */
export function canResend(lastSentAt: string | null, now: Date): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - new Date(lastSentAt).getTime() >= RESEND_COOLDOWN_MS;
}

export function codeExpiry(now: Date): string {
  return new Date(now.getTime() + CODE_TTL_MS).toISOString();
}

export const VERIFICATION_LIMITS = { CODE_TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS } as const;

// ── DB orchestration ─────────────────────────────────────────────────────────

interface ContactState {
  id: string;
  verified_at: string | null;
  verification_last_sent_at: string | null;
}

export type StartResult =
  | { ok: true; contactId: string }
  | { ok: false; status: number; error: string };

/**
 * Add (or reuse) a contact and send it a fresh code through the channel
 * abstraction. Session-scoped supabase only — RLS scopes every row to the user.
 */
export async function startVerification(
  supabase: SupabaseClient,
  userId: string,
  channel: NotificationChannelName,
  address: string,
  label: string | null,
): Promise<StartResult> {
  const send = getChannel(channel);
  if (!send) {
    return { ok: false, status: 503, error: `${channel} notifications aren't configured yet.` };
  }

  const { data: existing, error: findErr } = await supabase
    .from("notification_contacts")
    .select("id, verified_at, verification_last_sent_at")
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("address", address)
    .maybeSingle<ContactState>();
  if (findErr) return { ok: false, status: 500, error: "Couldn't look up your contacts." };

  if (existing?.verified_at) {
    return { ok: false, status: 409, error: "That address is already verified." };
  }
  const now = new Date();
  if (existing && !canResend(existing.verification_last_sent_at, now)) {
    return { ok: false, status: 429, error: "Please wait a minute before requesting another code." };
  }

  // First destination for this channel becomes primary (partial unique index
  // guarantees at most one, so this is safe to set on the first insert only).
  const { count, error: countErr } = await supabase
    .from("notification_contacts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("channel", channel);
  if (countErr) return { ok: false, status: 500, error: "Couldn't look up your contacts." };

  const code = generateCode();
  const row = {
    user_id: userId,
    channel,
    address,
    label,
    verification_code_hash: hashCode(code),
    verification_expires_at: codeExpiry(now),
    verification_attempts: 0,
    verification_last_sent_at: now.toISOString(),
    is_primary: (count ?? 0) === 0,
  };

  const { data: saved, error: upsertErr } = await supabase
    .from("notification_contacts")
    .upsert(row, { onConflict: "user_id,channel,address" })
    .select("id")
    .single<{ id: string }>();
  if (upsertErr || !saved) {
    return { ok: false, status: 500, error: "Couldn't save that contact." };
  }

  const email = renderVerificationCode({ code, expiresMinutes: CODE_TTL_MINUTES });
  const result = await send.send({
    to: address,
    subject: email.subject,
    body: email.text, // SMS uses this; email adds html below
    html: email.html,
    idempotencyKey: `verify:${saved.id}:${row.verification_last_sent_at}`,
  });
  if (!result.ok) {
    return { ok: false, status: 502, error: result.error ?? "Couldn't send the code. Try again." };
  }

  return { ok: true, contactId: saved.id };
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Check a submitted code and, on success, mark the contact verified. */
export async function confirmVerification(
  supabase: SupabaseClient,
  userId: string,
  contactId: string,
  submitted: string,
): Promise<ConfirmResult> {
  const { data: contact, error } = await supabase
    .from("notification_contacts")
    .select("verification_code_hash, verification_expires_at, verification_attempts")
    .eq("user_id", userId)
    .eq("id", contactId)
    .maybeSingle<{
      verification_code_hash: string | null;
      verification_expires_at: string | null;
      verification_attempts: number;
    }>();
  if (error) return { ok: false, status: 500, error: "Couldn't load that contact." };
  if (!contact) return { ok: false, status: 404, error: "Contact not found." };

  const outcome = checkCode(
    {
      hash: contact.verification_code_hash,
      expiresAt: contact.verification_expires_at,
      attempts: contact.verification_attempts,
    },
    submitted,
    new Date(),
  );

  if (outcome === "ok") {
    const { error: verifyErr } = await supabase
      .from("notification_contacts")
      .update({
        verified_at: new Date().toISOString(),
        verification_code_hash: null,
        verification_expires_at: null,
        verification_attempts: 0,
      })
      .eq("user_id", userId)
      .eq("id", contactId);
    if (verifyErr) return { ok: false, status: 500, error: "Couldn't confirm that code." };
    return { ok: true };
  }

  if (outcome === "mismatch") {
    // Burn an attempt; propagate the write error rather than fake a "wrong code".
    const { error: bumpErr } = await supabase
      .from("notification_contacts")
      .update({ verification_attempts: contact.verification_attempts + 1 })
      .eq("user_id", userId)
      .eq("id", contactId);
    if (bumpErr) return { ok: false, status: 500, error: "Couldn't record that attempt." };
    return { ok: false, status: 400, error: "That code is incorrect." };
  }

  const messages: Record<Exclude<CheckOutcome, "ok" | "mismatch">, string> = {
    expired: "That code has expired. Request a new one.",
    exhausted: "Too many attempts. Request a new code.",
    no_code: "No pending code for this contact. Request one first.",
  };
  return { ok: false, status: 400, error: messages[outcome] };
}
