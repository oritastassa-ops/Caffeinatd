import { normalizePhone } from "../address";
import {
  ContactAction,
  NormalizeResult,
  NotificationChannel,
  SendRequest,
  SendResult,
} from "../types";

/**
 * SMS delivery via the Twilio REST API, called directly with `fetch` — no SDK,
 * same precedent as src/lib/google/ and Phase 2's Resend client.
 *
 * Two Twilio quirks that people get wrong translating from the SDK, hence these
 * comments:
 *   1. The Messages endpoint takes application/x-www-form-urlencoded, NOT JSON.
 *   2. Auth is HTTP Basic: username = Account SID, password = Auth Token.
 *
 * Prefer a Messaging Service SID over a bare From number: it handles number
 * pooling, sticky sender, and A2P/compliance routing. Support both; use whichever
 * is configured.
 */

const LOG_PREFIX = "[notifications:sms]";
const SEND_TIMEOUT_MS = 10_000;

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from?: string; // TWILIO_FROM_NUMBER (E.164)
  messagingServiceSid?: string; // TWILIO_MESSAGING_SERVICE_SID (preferred)
}

interface TwilioResponse {
  sid?: string;
  status?: string;
  code?: number;
  message?: string;
}

// Error codes that must change how we treat this destination, not just this send.
// https://www.twilio.com/docs/api/errors
const CODE_OPTED_OUT = 21610; // recipient replied STOP — permanent, and mirror it
const CODE_INVALID_NUMBER = 21614; // not a valid mobile number — mark unverified
const CODE_REGION_BLOCKED = 21408; // geo-permission for the region not enabled

export class TwilioChannel implements NotificationChannel {
  readonly name = "sms" as const;

  constructor(private readonly config: TwilioConfig) {}

  normalizeAddress(raw: string): NormalizeResult {
    return normalizePhone(raw);
  }

  async send(req: SendRequest): Promise<SendResult> {
    const { accountSid, authToken, from, messagingServiceSid } = this.config;
    const body = new URLSearchParams();
    body.set("To", req.to);
    body.set("Body", req.body);
    if (messagingServiceSid) body.set("MessagingServiceSid", messagingServiceSid);
    else if (from) body.set("From", from);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            // HTTP Basic: SID:token, base64.
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            // Twilio honors Idempotency-Key on message create; our DB unique
            // index is the backstop where it doesn't.
            "I-Twilio-Idempotency-Token": req.idempotencyKey,
          },
          body: body.toString(),
          signal: controller.signal,
        },
      );
      return await this.mapResponse(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} network/timeout to=${req.to}: ${message}`);
      return { ok: false, error: "Couldn't reach the SMS provider. We'll retry.", retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  private async mapResponse(res: Response): Promise<SendResult> {
    const rawBody = await res.text();

    if (res.ok) {
      let sid: string | undefined;
      try {
        sid = (JSON.parse(rawBody) as TwilioResponse).sid;
      } catch {
        // A 2xx with an unparseable body still counts as accepted; sid missing.
      }
      return { ok: true, providerMessageId: sid, retryable: false };
    }

    // Log the raw body server-side (greppable), never return it.
    console.error(`${LOG_PREFIX} Twilio ${res.status}: ${rawBody}`);

    let code: number | undefined;
    try {
      code = (JSON.parse(rawBody) as TwilioResponse).code;
    } catch {
      // Fall through to status-based mapping.
    }
    return mapErrorCode(code, res.status);
  }
}

/** Pure error-code → SendResult mapping, exported so the table is unit-tested. */
export function mapErrorCode(code: number | undefined, httpStatus: number): SendResult {
  const permanent = (error: string, contactAction?: ContactAction): SendResult => ({
    ok: false,
    retryable: false,
    error,
    ...(contactAction ? { contactAction } : {}),
  });

  switch (code) {
    case CODE_OPTED_OUT:
      // Non-retryable AND write the opt-out back so nothing queues here again.
      return permanent("This number has opted out of messages.", "opt_out");
    case CODE_INVALID_NUMBER:
      return permanent("That isn't a valid mobile number.", "invalidate");
    case CODE_REGION_BLOCKED:
      return permanent("Messaging to that number's region isn't enabled.");
    default:
      break;
  }

  // 20429 (too many requests), 5xx, and anything else transient → retry.
  const retryable = code === 20429 || httpStatus === 429 || httpStatus >= 500;
  return {
    ok: false,
    retryable,
    error: retryable
      ? "The SMS provider is busy. We'll retry shortly."
      : "The message couldn't be delivered to that number.",
  };
}
