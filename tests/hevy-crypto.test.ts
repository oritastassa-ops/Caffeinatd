import { beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

describe("integration secret encryption", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  });

  it("round-trips a secret", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/integrations/crypto");
    const secret = "00000000-0000-0000-0000-000000000000";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { encryptSecret } = await import("@/lib/integrations/crypto");
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
  });

  it("throws if ENCRYPTION_KEY is missing", async () => {
    const original = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    const { encryptSecret } = await import("@/lib/integrations/crypto");
    expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = original;
  });
});
