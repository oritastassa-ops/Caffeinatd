import { NormalizeResult, NotificationChannelName } from "./types";

/**
 * Pure address validation + normalization, one function per channel. These are
 * the canonical normalizers: every channel's `normalizeAddress` delegates here,
 * and the contacts route calls them directly so adding a destination never
 * depends on a vendor being configured. Storing the normalized form is what
 * makes the (user, channel, address) uniqueness constraint meaningful — two
 * users can't fight over "Me@X.com" vs "me@x.com".
 */

// Deliberately conservative: one @, a dotted domain, no whitespace. We are not
// trying to fully parse RFC 5322 — an invalid address just fails verification
// and never receives mail, so the cost of a false reject is low and the cost of
// storing garbage is a permanently unverifiable contact.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): NormalizeResult {
  const address = raw.trim().toLowerCase();
  if (!address) return { ok: false, error: "Enter an email address." };
  if (address.length > 254) return { ok: false, error: "That email is too long." };
  if (!EMAIL_RE.test(address)) return { ok: false, error: "That doesn't look like an email address." };
  return { ok: true, address };
}

/**
 * Normalize to E.164 (`+` then 8–15 digits). We do not guess a country: a bare
 * national number is rejected rather than silently assumed to be +1, because a
 * wrong-country SMS is a real charge sent to a real stranger. A leading `00`
 * international prefix is accepted and rewritten to `+`.
 */
export function normalizePhone(raw: string): NormalizeResult {
  let s = raw.trim().replace(/[\s()\-.]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) {
    return { ok: false, error: "Enter the number in international format, e.g. +14155550123." };
  }
  const digits = s.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return { ok: false, error: "That doesn't look like a valid phone number." };
  }
  return { ok: true, address: `+${digits}` };
}

/** Route a raw address to the right normalizer for its channel. */
export function normalizeAddress(channel: NotificationChannelName, raw: string): NormalizeResult {
  return channel === "email" ? normalizeEmail(raw) : normalizePhone(raw);
}
