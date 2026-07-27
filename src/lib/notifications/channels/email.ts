import { normalizeEmail } from "../address";
import { NormalizeResult, NotificationChannel, SendRequest, SendResult } from "../types";

/**
 * Email delivery via the Resend REST API, called directly with `fetch` — no SDK,
 * matching the repo's Google-Calendar precedent (src/lib/google/calendar.ts,
 * README "No Google SDK"). Fewer deps, no version churn, and full control over
 * the error mapping below, which is the part that actually matters.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;
const LOG_PREFIX = "[notifications:email]";

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

export class ResendChannel implements NotificationChannel {
  readonly name = "email" as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  normalizeAddress(raw: string): NormalizeResult {
    return normalizeEmail(raw);
  }

  async send(req: SendRequest): Promise<SendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          // Resend dedupes retries with the same key within its window — this is
          // the transport-level backstop under our own DB idempotency.
          "Idempotency-Key": req.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: req.to,
          subject: req.subject ?? "",
          text: req.body,
          html: req.html,
          headers: req.headers,
        }),
        signal: controller.signal,
      });

      return await this.mapResponse(res);
    } catch (err) {
      // AbortError (timeout) and network failures are transient — retry.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} network/timeout to=${req.to}: ${message}`);
      return { ok: false, error: "Couldn't reach the email provider. We'll retry.", retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  private async mapResponse(res: Response): Promise<SendResult> {
    const raw = await res.text();

    if (res.ok) {
      let id: string | undefined;
      try {
        id = (JSON.parse(raw) as ResendResponse).id;
      } catch {
        // A 2xx with an unparseable body still counts as sent; id just missing.
      }
      return { ok: true, providerMessageId: id, retryable: false };
    }

    // Log the raw body server-side (greppable), never return it to the user.
    console.error(`${LOG_PREFIX} Resend ${res.status}: ${raw}`);

    // 429 and 5xx are transient; everything else in 4xx (bad address, suppressed
    // recipient, auth) will never succeed on retry, and retrying it burns quota
    // and delays real mail — so it fails terminally.
    const retryable = res.status === 429 || res.status >= 500;
    return {
      ok: false,
      error: retryable
        ? "The email provider is busy. We'll retry shortly."
        : "The email couldn't be delivered to that address.",
      retryable,
    };
  }
}
