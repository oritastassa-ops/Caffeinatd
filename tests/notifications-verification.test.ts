import { describe, expect, it } from "vitest";

// Must be set before the module (and the describe bodies that call hashCode at
// collection time) evaluate — hence module scope, not beforeAll.
process.env.NOTIFICATION_SECRET = "test-pepper-not-a-real-secret";

import {
  canResend,
  checkCode,
  generateCode,
  hashCode,
  hashesEqual,
  VERIFICATION_LIMITS,
} from "@/lib/notifications/verification";

const NOW = new Date("2026-07-27T12:00:00Z");
const future = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("code hashing", () => {
  it("never stores the plaintext code", () => {
    const code = "012345";
    const hash = hashCode(code);
    expect(hash).not.toBe(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code);
  });

  it("is deterministic and keyed (same code → same hash)", () => {
    expect(hashCode("111111")).toBe(hashCode("111111"));
    expect(hashCode("111111")).not.toBe(hashCode("222222"));
  });

  it("generates zero-padded 6-digit codes", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("hashesEqual is true only for identical digests", () => {
    expect(hashesEqual(hashCode("424242"), hashCode("424242"))).toBe(true);
    expect(hashesEqual(hashCode("424242"), hashCode("424243"))).toBe(false);
    expect(hashesEqual("", "")).toBe(false);
  });
});

describe("checkCode", () => {
  const code = "654321";
  const stored = { hash: hashCode(code), expiresAt: future(5 * 60_000), attempts: 0 };

  it("accepts the right code before expiry", () => {
    expect(checkCode(stored, code, NOW)).toBe("ok");
  });

  it("rejects the wrong code", () => {
    expect(checkCode(stored, "000000", NOW)).toBe("mismatch");
  });

  it("rejects an expired code even if correct", () => {
    const expired = { hash: hashCode(code), expiresAt: future(-1), attempts: 0 };
    expect(checkCode(expired, code, NOW)).toBe("expired");
  });

  it("rejects once attempts are exhausted, before comparing the hash", () => {
    const dead = { hash: hashCode(code), expiresAt: future(5 * 60_000), attempts: VERIFICATION_LIMITS.MAX_ATTEMPTS };
    expect(checkCode(dead, code, NOW)).toBe("exhausted");
  });

  it("reports no_code when nothing is pending", () => {
    expect(checkCode({ hash: null, expiresAt: null, attempts: 0 }, code, NOW)).toBe("no_code");
  });
});

describe("canResend cooldown", () => {
  it("allows a first send and blocks within the cooldown", () => {
    expect(canResend(null, NOW)).toBe(true);
    expect(canResend(future(-30_000), NOW)).toBe(false);
    expect(canResend(future(-VERIFICATION_LIMITS.RESEND_COOLDOWN_MS - 1), NOW)).toBe(true);
  });
});
