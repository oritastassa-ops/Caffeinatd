import { describe, expect, it } from "vitest";
import { isUrgentKind, resolveSendTime } from "@/lib/notifications/schedule";

const quiet = { quietHoursStart: "22:00", quietHoursEnd: "08:00" }; // crosses midnight
const none = { quietHoursStart: null, quietHoursEnd: null };

describe("resolveSendTime", () => {
  it("sends unchanged outside quiet hours", () => {
    const desired = new Date("2026-07-27T15:00:00Z"); // 15:00 UTC
    const r = resolveSendTime(desired, quiet, "UTC");
    expect(r.deferred).toBe(false);
    expect(r.sendAt).toEqual(desired);
  });

  it("defers a late-night time to the window's end next morning", () => {
    const r = resolveSendTime(new Date("2026-07-27T23:30:00Z"), quiet, "UTC");
    expect(r.deferred).toBe(true);
    expect(r.sendAt.toISOString()).toBe("2026-07-28T08:00:00.000Z");
  });

  it("defers an early-morning time to 08:00 the same day", () => {
    const r = resolveSendTime(new Date("2026-07-27T03:00:00Z"), quiet, "UTC");
    expect(r.deferred).toBe(true);
    expect(r.sendAt.toISOString()).toBe("2026-07-27T08:00:00.000Z");
  });

  it("urgent bypasses quiet hours entirely", () => {
    const desired = new Date("2026-07-27T03:00:00Z");
    expect(resolveSendTime(desired, quiet, "UTC", { urgent: true }).deferred).toBe(false);
  });

  it("applies the SMS hard floor even with no user quiet hours", () => {
    const r = resolveSendTime(new Date("2026-07-27T23:00:00Z"), none, "UTC", { channel: "sms" });
    expect(r.deferred).toBe(true);
    expect(r.sendAt.toISOString()).toBe("2026-07-28T08:00:00.000Z");
  });

  it("does not apply the SMS floor to email", () => {
    expect(resolveSendTime(new Date("2026-07-27T23:00:00Z"), none, "UTC", { channel: "email" }).deferred).toBe(false);
  });

  it("resolves 08:00 local correctly on the DST spring-forward day (23-hour day)", () => {
    // 2026-03-08, US DST begins. 03:00 EDT is inside 22:00–08:00; the window end
    // 08:00 EDT is 12:00 UTC (offset −4), not 13:00 (−5).
    const r = resolveSendTime(new Date("2026-03-08T07:00:00Z"), quiet, "America/New_York");
    expect(r.sendAt.toISOString()).toBe("2026-03-08T12:00:00.000Z");
  });

  it("resolves 08:00 local correctly on the DST fall-back day (25-hour day)", () => {
    // 2026-11-01, US DST ends. 05:00 EST is inside the window; 08:00 EST is
    // 13:00 UTC (offset −5).
    const r = resolveSendTime(new Date("2026-11-01T10:00:00Z"), quiet, "America/New_York");
    expect(r.sendAt.toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });
});

describe("isUrgentKind", () => {
  it("marks system urgent and ordinary kinds not", () => {
    expect(isUrgentKind("system")).toBe(true);
    expect(isUrgentKind("reminder")).toBe(false);
    expect(isUrgentKind("daily_plan")).toBe(false);
  });
});
