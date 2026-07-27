import { describe, expect, it } from "vitest";
import { buildChannelRegistry } from "@/lib/notifications/registry";

describe("channel registry", () => {
  it("routes both channels to a logging stub in the default driver", () => {
    const reg = buildChannelRegistry({ NOTIFICATIONS_DRIVER: "logging" });
    expect(reg.email?.name).toBe("email");
    expect(reg.sms?.name).toBe("sms");
    // The stub still validates addresses via the shared normalizers.
    expect(reg.email?.normalizeAddress("A@B.CO")).toEqual({ ok: true, address: "a@b.co" });
  });

  it("defaults to logging when no driver is set", () => {
    const reg = buildChannelRegistry({});
    expect(reg.email).toBeDefined();
  });

  it("leaves a channel absent (getChannel-null) when its vendor isn't configured", () => {
    const reg = buildChannelRegistry({ NOTIFICATIONS_DRIVER: "resend" });
    // Callers check presence rather than catching a throw.
    expect(reg.email ?? null).toBeNull();
    expect(reg.sms ?? null).toBeNull();
  });
});
