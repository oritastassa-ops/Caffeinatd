import crypto from "node:crypto";

/**
 * Twilio request signature validation — the single most important security
 * control in the SMS webhook. An unauthenticated endpoint that flips opt-out
 * state is a trivial denial-of-service against your own users (POST STOP for
 * every number and nobody gets messages again), so NOTHING in the body is
 * trusted until this passes.
 *
 * Algorithm (for application/x-www-form-urlencoded POSTs):
 *   1. Start with the exact URL Twilio requested.
 *   2. Append each POST param as key+value, sorted by key, no separators.
 *   3. HMAC-SHA1 with the auth token, base64-encoded.
 *   4. Constant-time compare to the X-Twilio-Signature header.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!authToken || !signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
