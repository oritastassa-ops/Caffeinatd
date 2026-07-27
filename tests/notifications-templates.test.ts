import { describe, expect, it } from "vitest";

process.env.NOTIFICATION_SECRET = "test-pepper-not-a-real-secret";

import { renderEmail, renderVerificationCode } from "@/lib/notifications/templates";
import { parseUnsubscribe, signUnsubscribe } from "@/lib/notifications/unsubscribe";
import type { NotificationKind } from "@/lib/notifications/types";

const ctx = { unsubscribeUrl: "https://app.test/api/notifications/unsubscribe?token=T" };

describe("email templates render text and email-safe html", () => {
  const daily = renderEmail(
    "daily_plan",
    { name: "Ori", plan: { date: "2026-07-28", overview: "A calm day.", priorities: ["Ship Phase 2", "Call the bank"], workout: "Push day", nutrition: "Protein", freeWindows: ["14:00–16:00"], home: "Recycling out tonight", bedtime: "23:15" } },
    ctx,
  )!;

  it("puts real content in the plain-text part (watches read this)", () => {
    expect(daily.subject).toBe("Your plan for 2026-07-28");
    expect(daily.text).toContain("Good morning, Ori");
    expect(daily.text).toContain("• Ship Phase 2");
    expect(daily.text).toContain("Workout: Push day");
    expect(daily.text).toContain("Turn these off:"); // unsubscribe in text too
  });

  it("uses table layout with no flex/grid and no external CSS", () => {
    expect(daily.html).not.toMatch(/display:\s*(flex|grid)/i);
    expect(daily.html).not.toContain("<link");
    expect(daily.html).toContain("<table");
    expect(daily.html).toContain("max-width:600px");
    expect(daily.html).toContain(ctx.unsubscribeUrl); // one-click link present
  });

  it("escapes payload content into the html (no injection)", () => {
    const evil = renderEmail("reminder", { message: "<script>alert(1)</script>" }, ctx)!;
    expect(evil.html).not.toContain("<script>alert(1)</script>");
    expect(evil.html).toContain("&lt;script&gt;");
    expect(evil.text).toContain("<script>alert(1)</script>"); // text is literal, that's fine
  });

  it("returns null for a kind with no email template", () => {
    // Every real kind is templated as of Phase 4; an unknown kind still degrades
    // to null (the worker then records a non-retryable failure) rather than throw.
    expect(renderEmail("mystery_kind" as NotificationKind, { message: "x" }, ctx)).toBeNull();
  });

  it("verification is transactional — has a code, no unsubscribe footer", () => {
    const v = renderVerificationCode({ code: "012345" });
    expect(v.text).toContain("012345");
    expect(v.html).toContain("012345");
    expect(v.text).not.toContain("Turn these off");
  });
});

describe("unsubscribe token", () => {
  it("round-trips a signed (user, kind)", () => {
    const token = signUnsubscribe("user-abc", "daily_plan");
    expect(parseUnsubscribe(token)).toEqual({ userId: "user-abc", kind: "daily_plan" });
  });

  it("rejects a tampered token", () => {
    const token = signUnsubscribe("user-abc", "daily_plan");
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    expect(parseUnsubscribe(tampered)).toBeNull();
  });

  it("rejects a token whose body was swapped under a stale signature", () => {
    const a = signUnsubscribe("user-abc", "daily_plan");
    const b = signUnsubscribe("user-xyz", "reminder");
    const spliced = a.slice(0, a.indexOf(".")) + b.slice(b.indexOf(".")); // body of a, sig of b
    expect(parseUnsubscribe(spliced)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseUnsubscribe("not-a-token")).toBeNull();
    expect(parseUnsubscribe("")).toBeNull();
  });
});
