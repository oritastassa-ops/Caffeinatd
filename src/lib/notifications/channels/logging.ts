import { randomUUID } from "node:crypto";
import { normalizeAddress } from "../address";
import {
  NormalizeResult,
  NotificationChannel,
  NotificationChannelName,
  SendRequest,
  SendResult,
} from "../types";

/**
 * A channel that "sends" by writing to the server log and returning a synthetic
 * message id. Registered for every channel name when NOTIFICATIONS_DRIVER=logging.
 * It exists so the whole delivery path — enqueue → claim → send → record — is
 * exercisable in local dev and in tests before Resend or Twilio exist, at zero
 * cost and with no network. Normalization delegates to the shared normalizers,
 * so a logging-mode contact validates exactly as a real one will.
 */
export class LoggingChannel implements NotificationChannel {
  constructor(readonly name: NotificationChannelName) {}

  normalizeAddress(raw: string): NormalizeResult {
    return normalizeAddress(this.name, raw);
  }

  async send(req: SendRequest): Promise<SendResult> {
    const providerMessageId = `log_${randomUUID()}`;
    console.info(
      `[notifications:logging] channel=${this.name} to=${req.to} id=${providerMessageId} ` +
        `idem=${req.idempotencyKey}` +
        (req.subject ? ` subject=${JSON.stringify(req.subject)}` : "") +
        ` body=${JSON.stringify(req.body)}`,
    );
    return { ok: true, providerMessageId, retryable: false };
  }
}
