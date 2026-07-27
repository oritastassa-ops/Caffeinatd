import { CountryCode, parsePhoneNumberFromString } from "libphonenumber-js";
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
 * Normalize to strict E.164 using libphonenumber-js — a real parser with
 * Google's per-region metadata, not a regex. A regex can only check shape:
 * `+15551234567` is well-formed but not a number that exists, and Twilio bills
 * us to reject it. The parser validates the number is possible for its region
 * and returns canonical E.164. See docs/14 for why the dependency earns its keep.
 *
 * A bare national number is only accepted when NOTIFICATIONS_DEFAULT_REGION is
 * set (ISO 3166-1 alpha-2, e.g. "US") — otherwise we refuse to guess a country,
 * because a wrong-country SMS is a real charge to a real stranger.
 */
export function normalizePhone(raw: string): NormalizeResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: "Enter a phone number." };

  const region = process.env.NOTIFICATIONS_DEFAULT_REGION as CountryCode | undefined;
  const parsed = parsePhoneNumberFromString(input, region);

  if (!parsed || !parsed.isValid()) {
    return {
      ok: false,
      error: region
        ? "That doesn't look like a valid phone number."
        : "Enter the number in international format, e.g. +14155550123.",
    };
  }
  return { ok: true, address: parsed.number }; // E.164, e.g. +14155550123
}

/** Route a raw address to the right normalizer for its channel. */
export function normalizeAddress(channel: NotificationChannelName, raw: string): NormalizeResult {
  return channel === "email" ? normalizeEmail(raw) : normalizePhone(raw);
}
