import { NextRequest, NextResponse, after } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";
import { getChannel } from "@/lib/notifications/registry";
import { processInbound } from "@/lib/notifications/inbound";
import { validateTwilioSignature } from "@/lib/notifications/twilio-signature";

/**
 * Twilio webhook: status callbacks (delivery receipts), STOP/START/HELP
 * compliance keywords, and — since Phase 14 — conversational replies routed
 * through the assistant. Service-role client, because there is no session; but
 * every mutation is keyed off the phone NUMBER in a signature-verified body,
 * never a user id from the request, and the assistant runs scoped to the one
 * user that number's VERIFIED contact resolves to (see lib/notifications/inbound).
 */

// The assistant reply runs in after() (below), so it can take longer than
// Twilio's webhook timeout. Requires Vercel fluid compute for >60s.
export const maxDuration = 300;

const LOG_PREFIX = "[notifications:sms:inbound]";

// A2P compliance keywords (case-insensitive, first word of the message).
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

function twiml(): NextResponse {
  // Empty TwiML: we handle state; Twilio's Advanced Opt-Out sends the compliant
  // STOP/HELP/START auto-replies on the messaging service.
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "content-type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature");

  // Parse the form body once; we need the raw params both to validate and to act.
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  // Reconstruct the exact URL Twilio signed. APP_URL must match the webhook's
  // configured scheme+host; the path/query come from the request.
  const { pathname, search } = new URL(req.url);
  const url = `${process.env.APP_URL ?? ""}${pathname}${search}`;

  if (!authToken || !validateTwilioSignature(authToken, url, params, signature)) {
    // Never trust — reject before touching any state.
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  const supabase = getServiceClient();

  // Status callback (delivery receipt) — update the delivery by provider id.
  const status = params.MessageStatus ?? params.SmsStatus;
  if (status) {
    await handleStatusCallback(supabase, params.MessageSid ?? params.SmsSid, status, params.ErrorCode);
    return new NextResponse(null, { status: 204 });
  }

  // Inbound message — STOP/START/HELP keyword mirroring, else the assistant.
  const body = params.Body;
  const from = params.From;
  const messageSid = params.MessageSid ?? params.SmsSid;
  if (body && from && messageSid) {
    await handleInbound(supabase, from, body, messageSid);
    return twiml();
  }

  return new NextResponse(null, { status: 204 });
}

async function handleStatusCallback(
  supabase: ReturnType<typeof getServiceClient>,
  messageSid: string | undefined,
  status: string,
  errorCode: string | undefined,
): Promise<void> {
  if (!messageSid) return;
  // delivered → confirmed sent (no change). undelivered/failed → mark failed so
  // the delivery log tells the truth about what actually reached the user.
  if (status !== "undelivered" && status !== "failed") return;

  const { error } = await supabase
    .from("notification_deliveries")
    .update({ status: "failed", last_error: `twilio: ${status}${errorCode ? ` (${errorCode})` : ""}` })
    .eq("provider_message_id", messageSid);
  if (error) console.error(`${LOG_PREFIX} status update failed for ${messageSid}: ${error.message}`);
}

async function handleInbound(
  supabase: ReturnType<typeof getServiceClient>,
  from: string,
  body: string,
  messageSid: string,
): Promise<void> {
  const keyword = body.trim().split(/\s+/)[0]?.toUpperCase() ?? "";

  // Compliance keywords are law and come FIRST — a STOP is never a prompt, and
  // must never reach the assistant. These mirror Twilio's own opt-out state.
  if (STOP_WORDS.has(keyword)) {
    return mirrorOptOut(supabase, from, new Date().toISOString());
  }
  if (START_WORDS.has(keyword)) {
    return mirrorOptOut(supabase, from, null); // re-subscribe
  }
  if (HELP_WORDS.has(keyword)) {
    // Twilio auto-replies with the service's HELP text; no state to mirror.
    return;
  }

  // Conversational reply → the assistant. Run in after() so the webhook returns
  // immediately (Twilio won't retry a fast 200) while the reason/act loop and
  // the SMS reply happen out of band. Dedupe on MessageSid backstops the retry
  // race regardless. processInbound self-audits every outcome to inbound_messages.
  after(async () => {
    try {
      await processInbound(
        { supabase, provider: getProvider(), getChannel },
        { channel: "sms", providerMessageId: messageSid, from, body },
      );
    } catch (err) {
      console.error(`${LOG_PREFIX} pipeline error: ${err instanceof Error ? err.message : err}`);
    }
  });
}

/** Mirror Twilio's opt-out state onto every contact holding this number. */
async function mirrorOptOut(
  supabase: ReturnType<typeof getServiceClient>,
  number: string,
  optedOutAt: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("notification_contacts")
    .update({ opted_out_at: optedOutAt })
    .eq("channel", "sms")
    .eq("address", number);
  if (error) console.error(`${LOG_PREFIX} opt-out mirror failed: ${error.message}`);
}
