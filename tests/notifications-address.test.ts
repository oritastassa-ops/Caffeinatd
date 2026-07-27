import { describe, expect, it } from "vitest";
import { normalizeAddress, normalizeEmail, normalizePhone } from "@/lib/notifications/address";

describe("normalizeEmail", () => {
  it("lower-cases and trims a valid address", () => {
    const r = normalizeEmail("  Me@Example.COM ");
    expect(r).toEqual({ ok: true, address: "me@example.com" });
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "me", "me@", "@x.com", "me@x", "a b@x.com", "me@@x.com"]) {
      expect(normalizeEmail(bad).ok).toBe(false);
    }
  });

  it("rejects an absurdly long address", () => {
    expect(normalizeEmail(`${"a".repeat(250)}@x.com`).ok).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("accepts E.164 and canonicalizes formatting", () => {
    expect(normalizePhone("+1 (650) 253-0000")).toEqual({ ok: true, address: "+16502530000" });
    expect(normalizePhone("+44 7911 123456")).toEqual({ ok: true, address: "+447911123456" });
  });

  it("rejects a well-formed but impossible number (real parser, not a regex)", () => {
    // Shape-valid but not a real NANP number — the exact class a regex misses.
    expect(normalizePhone("+1 555 555 5555").ok).toBe(false);
    expect(normalizePhone("+12").ok).toBe(false);
    expect(normalizePhone("+abcdefghij").ok).toBe(false);
  });

  it("refuses a bare national number when no default region is configured", () => {
    delete process.env.NOTIFICATIONS_DEFAULT_REGION;
    expect(normalizePhone("6502530000").ok).toBe(false);
  });

  it("accepts a national number when NOTIFICATIONS_DEFAULT_REGION is set", () => {
    process.env.NOTIFICATIONS_DEFAULT_REGION = "US";
    try {
      expect(normalizePhone("(650) 253-0000")).toEqual({ ok: true, address: "+16502530000" });
    } finally {
      delete process.env.NOTIFICATIONS_DEFAULT_REGION;
    }
  });
});

describe("normalizeAddress dispatch", () => {
  it("routes to the channel's normalizer", () => {
    expect(normalizeAddress("email", "A@B.CO")).toEqual({ ok: true, address: "a@b.co" });
    expect(normalizeAddress("sms", "+16502530000").ok).toBe(true);
  });
});
