import crypto from "node:crypto";

/**
 * Shared secret + HMAC helpers for the notification pillar: verification-code
 * hashing (verification.ts) and unsubscribe-link signing (unsubscribe.ts) both
 * key off the same server-side secret. Kept in one place so the "which key"
 * decision is made once.
 *
 * A dedicated NOTIFICATION_SECRET is preferred; we fall back to ENCRYPTION_KEY
 * (already required, server-only, 32-byte) so a fresh deploy works without a new
 * var. The tradeoff — reusing the at-rest key as an HMAC pepper — is documented
 * in docs/14; set NOTIFICATION_SECRET to separate the two.
 */
export function notificationSecret(): string {
  const secret = process.env.NOTIFICATION_SECRET ?? process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "NOTIFICATION_SECRET (or ENCRYPTION_KEY) is not set — required for notification signing",
    );
  }
  return secret;
}

/** HMAC-SHA256 of `data`, hex-encoded. */
export function hmacHex(data: string): string {
  return crypto.createHmac("sha256", notificationSecret()).update(data).digest("hex");
}

/** Constant-time compare of two hex digests (avoids a length/timing leak). */
export function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}
