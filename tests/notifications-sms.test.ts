import { afterEach, describe, expect, it, vi } from "vitest";
import { mapErrorCode, TwilioChannel } from "@/lib/notifications/channels/sms";
import { SendRequest } from "@/lib/notifications/types";

describe("mapErrorCode", () => {
  it("21610 (opted out) → non-retryable and signals opt_out", () => {
    expect(mapErrorCode(21610, 400)).toMatchObject({
      ok: false,
      retryable: false,
      contactAction: "opt_out",
    });
  });

  it("21614 (invalid number) → non-retryable and signals invalidate", () => {
    expect(mapErrorCode(21614, 400)).toMatchObject({
      ok: false,
      retryable: false,
      contactAction: "invalidate",
    });
  });

  it("21408 (region not enabled) → non-retryable, no contact mutation", () => {
    const r = mapErrorCode(21408, 400);
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(r.contactAction).toBeUndefined();
  });

  it("20429 / 5xx → retryable", () => {
    expect(mapErrorCode(20429, 429).retryable).toBe(true);
    expect(mapErrorCode(undefined, 503).retryable).toBe(true);
  });

  it("an unknown 4xx → non-retryable", () => {
    expect(mapErrorCode(30007, 400).retryable).toBe(false);
  });
});

const channel = new TwilioChannel({ accountSid: "AC123", authToken: "tok", from: "+15550000000" });
const req: SendRequest = { to: "+14155550123", body: "hi", idempotencyKey: "k1" };

afterEach(() => vi.restoreAllMocks());

describe("TwilioChannel.send", () => {
  it("posts form-encoded with basic auth and returns the message sid on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sid: "SM123", status: "queued" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: true, providerMessageId: "SM123" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(init.body).toContain("To=%2B14155550123"); // URL-encoded +
  });

  it("maps a 400 with code 21610 to an opt-out signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 21610, message: "opted out" }), { status: 400 })),
    );
    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: false, retryable: false, contactAction: "opt_out" });
  });

  it("treats a network error as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: false, retryable: true });
  });
});
