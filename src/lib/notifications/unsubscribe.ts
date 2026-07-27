import { hexEqual, hmacHex } from "./crypto";
import { NotificationKind, NOTIFICATION_KINDS } from "./types";

/**
 * One-click unsubscribe tokens. A bare user id in an email URL is an enumeration
 * hole (guess a uuid, unsubscribe a stranger); signing (user, kind) with an HMAC
 * closes that and satisfies Gmail's List-Unsubscribe expectations. The token is
 * `base64url(userId:kind).base64url(hmac)` — stateless, no DB row to store.
 */

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromB64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signUnsubscribe(userId: string, kind: NotificationKind): string {
  const body = b64url(`${userId}:${kind}`);
  const sig = Buffer.from(hmacHex(body), "hex").toString("base64url");
  return `${body}.${sig}`;
}

export interface UnsubscribeClaim {
  userId: string;
  kind: NotificationKind;
}

/** Verify + decode a token. Returns null on any tampering or malformed input. */
export function parseUnsubscribe(token: string): UnsubscribeClaim | null {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedHex = hmacHex(body);
  let providedHex: string;
  try {
    providedHex = Buffer.from(sig, "base64url").toString("hex");
  } catch {
    return null;
  }
  if (!hexEqual(expectedHex, providedHex)) return null;

  const decoded = fromB64url(body);
  const sep = decoded.lastIndexOf(":");
  if (sep === -1) return null;
  const userId = decoded.slice(0, sep);
  const kind = decoded.slice(sep + 1);
  if (!userId || !(NOTIFICATION_KINDS as readonly string[]).includes(kind)) return null;

  return { userId, kind: kind as NotificationKind };
}
