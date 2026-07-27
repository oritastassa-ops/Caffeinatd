import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/notifications/templates";

const ctx = { unsubscribeUrl: "https://app.test/api/notifications/unsubscribe?token=T" };

describe("digest rendering", () => {
  const items = ["Protein is 25g behind pace", "Squat has not progressed this month", "3 tasks are overdue"];
  const payload = { digest: true, items: items.map((line) => ({ line })) };

  it("coalesces N items into one email containing all of them", () => {
    const email = renderEmail("insight", payload, ctx);
    expect(email).not.toBeNull();
    for (const item of items) {
      expect(email!.text).toContain(item);
      expect(email!.html).toContain(item);
    }
  });

  it("counts the items in the subject", () => {
    const email = renderEmail("insight", payload, ctx)!;
    expect(email.subject).toMatch(/3 updates/);
  });

  it("keeps the one-click unsubscribe in a digest too", () => {
    const email = renderEmail("insight", payload, ctx)!;
    expect(email.html).toContain(ctx.unsubscribeUrl);
    expect(email.text).toContain("Turn these off");
  });

  it("throws on an empty digest rather than sending a blank email", () => {
    expect(() => renderEmail("insight", { digest: true, items: [] }, ctx)).toThrow();
  });
});
