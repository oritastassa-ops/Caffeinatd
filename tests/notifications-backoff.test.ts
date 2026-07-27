import { describe, expect, it } from "vitest";
import { backoffMs, MAX_ATTEMPTS, resolveOutcome } from "@/lib/notifications/backoff";
import { SendResult } from "@/lib/notifications/types";

const ok: SendResult = { ok: true, retryable: false, providerMessageId: "m1" };
const retryable: SendResult = { ok: false, retryable: true, error: "busy" };
const permanent: SendResult = { ok: false, retryable: false, error: "bad address" };

describe("backoffMs schedule", () => {
  it("is 0 before the first send, then 1m, 5m, 25m, 2h", () => {
    expect(backoffMs(1)).toBe(0);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(5 * 60_000);
    expect(backoffMs(4)).toBe(25 * 60_000);
    expect(backoffMs(5)).toBe(2 * 60 * 60_000);
  });

  it("caps at 2h beyond the schedule", () => {
    expect(backoffMs(6)).toBe(2 * 60 * 60_000);
    expect(backoffMs(50)).toBe(2 * 60 * 60_000);
  });
});

describe("resolveOutcome", () => {
  it("sends on success", () => {
    expect(resolveOutcome(ok, 0)).toEqual({ status: "sent", attempts: 1 });
  });

  it("retries a retryable failure with backoff while attempts remain", () => {
    expect(resolveOutcome(retryable, 0)).toEqual({
      status: "pending",
      attempts: 1,
      retryDelayMs: backoffMs(2),
    });
    expect(resolveOutcome(retryable, 3)).toEqual({
      status: "pending",
      attempts: 4,
      retryDelayMs: backoffMs(5),
    });
  });

  it("fails a retryable failure once the attempt budget is spent", () => {
    expect(resolveOutcome(retryable, MAX_ATTEMPTS - 1)).toEqual({
      status: "failed",
      attempts: MAX_ATTEMPTS,
    });
  });

  it("fails a non-retryable failure immediately", () => {
    expect(resolveOutcome(permanent, 0)).toEqual({ status: "failed", attempts: 1 });
  });
});
