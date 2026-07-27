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
  it("accepts E.164 and strips separators", () => {
    expect(normalizePhone("+1 (415) 555-0123")).toEqual({ ok: true, address: "+14155550123" });
  });

  it("rewrites a 00 international prefix to +", () => {
    expect(normalizePhone("00447911123456")).toEqual({ ok: true, address: "+447911123456" });
  });

  it("refuses to guess a country for a bare national number", () => {
    expect(normalizePhone("4155550123").ok).toBe(false);
  });

  it("rejects non-numeric, too-short, and leading-zero numbers", () => {
    for (const bad of ["+", "+0123456789", "+12", "+abcdefghij", "12345"]) {
      expect(normalizePhone(bad).ok).toBe(false);
    }
  });
});

describe("normalizeAddress dispatch", () => {
  it("routes to the channel's normalizer", () => {
    expect(normalizeAddress("email", "A@B.CO")).toEqual({ ok: true, address: "a@b.co" });
    expect(normalizeAddress("sms", "+14155550123").ok).toBe(true);
  });
});
