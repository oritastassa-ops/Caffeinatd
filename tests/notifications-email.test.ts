import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendChannel } from "@/lib/notifications/channels/email";
import { SendRequest } from "@/lib/notifications/types";

const channel = new ResendChannel("re_test_key", "Caffeinatd <hi@caffeinatd.app>");

const req: SendRequest = {
  to: "me@example.com",
  subject: "Hi",
  body: "plain",
  html: "<p>plain</p>",
  idempotencyKey: "k1",
};

function mockFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue(
    new Response(body, { status, headers: { "content-type": "application/json" } }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ResendChannel.send response mapping", () => {
  it("200 → ok with the provider message id", async () => {
    vi.stubGlobal("fetch", mockFetch(200, JSON.stringify({ id: "abc123" })));
    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: true, providerMessageId: "abc123", retryable: false });
  });

  it("401 → non-retryable (auth won't fix itself on retry)", async () => {
    vi.stubGlobal("fetch", mockFetch(401, JSON.stringify({ message: "invalid key" })));
    const res = await channel.send(req);
    expect(res.ok).toBe(false);
    expect(res.retryable).toBe(false);
  });

  it("422 → non-retryable (bad/suppressed recipient)", async () => {
    vi.stubGlobal("fetch", mockFetch(422, JSON.stringify({ message: "invalid to" })));
    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: false, retryable: false });
  });

  it("429 → retryable", async () => {
    vi.stubGlobal("fetch", mockFetch(429, "rate limited"));
    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: false, retryable: true });
  });

  it("500 → retryable", async () => {
    vi.stubGlobal("fetch", mockFetch(500, "server error"));
    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: false, retryable: true });
  });

  it("network/abort error → retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const res = await channel.send(req);
    expect(res).toMatchObject({ ok: false, retryable: true });
  });

  it("never leaks the raw provider body into the user-facing error", async () => {
    vi.stubGlobal("fetch", mockFetch(422, JSON.stringify({ message: "secret internal detail" })));
    const res = await channel.send(req);
    expect(res.error ?? "").not.toContain("secret internal detail");
  });
});
