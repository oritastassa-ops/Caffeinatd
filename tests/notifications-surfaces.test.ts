import { describe, expect, it } from "vitest";
import { maskAddress, maskEmail, maskPhone } from "@/lib/notifications/mask";
import { deriveCellState, testSendBlocked, TEST_SEND_MAX } from "@/lib/notifications/matrix";
import { NotificationChannelName } from "@/lib/notifications/types";

describe("address masking never leaks the full value", () => {
  it("masks the local part of an email but keeps the domain", () => {
    expect(maskEmail("jordan.lee@example.com")).toBe("j••@example.com");
    expect(maskEmail("a@b.co")).toBe("a••@b.co");
    // The masked output must not contain the hidden characters of the local part.
    expect(maskEmail("jordan.lee@example.com")).not.toContain("ordan.lee");
  });

  it("masks a phone to just the last four digits", () => {
    const masked = maskPhone("+14155550123");
    expect(masked).toContain("0123");
    expect(masked).not.toContain("14155550123"); // the full number never appears
    expect(masked).not.toContain("4155"); // nor the hidden middle
    expect(maskPhone("+447911123456")).toContain("3456");
  });

  it("degrades safely on malformed input", () => {
    expect(maskEmail("notanemail")).toBe("•••");
    expect(maskPhone("+12")).toBe("•••");
  });

  it("dispatches by channel", () => {
    expect(maskAddress("email", "x@y.com")).toBe("x••@y.com");
    expect(maskAddress("sms", "+14155550123")).toContain("0123");
  });
});

describe("preference matrix cell derivation", () => {
  const configured = new Set<NotificationChannelName>(["email", "sms"]);
  const verified = new Set<NotificationChannelName>(["email"]);

  it("is usable and reflects the toggle when the channel has a verified contact", () => {
    expect(deriveCellState("reminder", "email", ["email"], configured, verified)).toEqual({
      checked: true,
      usable: true,
      reason: null,
    });
  });

  it("disables a channel with no verified contact, with a reason", () => {
    const cell = deriveCellState("reminder", "sms", ["email"], configured, verified);
    expect(cell.usable).toBe(false);
    expect(cell.checked).toBe(false);
    expect(cell.reason).toMatch(/verify a phone/i);
  });

  it("disables a channel the server hasn't configured, with a different reason", () => {
    const cell = deriveCellState("reminder", "sms", ["email"], new Set(["email"]), verified);
    expect(cell.usable).toBe(false);
    expect(cell.reason).toMatch(/isn't set up/i);
  });

  it("reports checked state independent of usability", () => {
    // A kind can have sms enabled from before the phone was removed — still shown checked.
    const cell = deriveCellState("reminder", "sms", ["email", "sms"], configured, verified);
    expect(cell.checked).toBe(true);
    expect(cell.usable).toBe(false);
  });
});

describe("test-send rate limit", () => {
  it("blocks only once the cap is reached in the window", () => {
    expect(testSendBlocked(0)).toBe(false);
    expect(testSendBlocked(TEST_SEND_MAX - 1)).toBe(false);
    expect(testSendBlocked(TEST_SEND_MAX)).toBe(true);
    expect(testSendBlocked(TEST_SEND_MAX + 3)).toBe(true);
  });
});
