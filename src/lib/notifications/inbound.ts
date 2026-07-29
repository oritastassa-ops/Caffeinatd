import { SupabaseClient } from "@supabase/supabase-js";
import { AIProvider } from "@/lib/ai/types";
import { scopedClient } from "@/lib/supabase/scoped";
import { loadProfile, runAssistant } from "@/lib/pipeline/run";
import { recordExchange } from "@/lib/conversations";
import { INBOUND_TOOLS } from "./inbound-scope";
import { formatSmsReply } from "./inbound-reply";
import { localDay } from "./limits";
import { NotificationChannel, NotificationChannelName } from "./types";

/**
 * The channel-agnostic inbound pipeline: verify (done in the route) → dedupe →
 * resolve → rate-limit → thread → runAssistant (scoped tools) → reply → record.
 * SMS and email both call processInbound; neither reimplements it.
 *
 * This is the first surface where something outside the app can cause a write,
 * so the guards in front of the AI call are the whole security story. Read
 * docs/14-notifications-architecture.md § Inbound before changing the order.
 */

const LOG_PREFIX = "[notifications:inbound]";

// Rate limits, enforced per resolved contact BEFORE any AI call — the model is
// the expensive part, so the guard sits in front of it. Generous enough for a
// real back-and-forth, tight enough that a spoof-or-loop can't run up a bill.
const MAX_PER_MINUTE = 4;
const MAX_PER_HOUR = 20;

// SMS gives no thread reference, so a reply is attached to the most recent
// delivery to this contact within this window. It will sometimes be wrong (a
// reply to yesterday's plan after a fresh one went out) — documented, not hidden.
const THREAD_WINDOW_HOURS = 12;

export interface InboundMessage {
  channel: NotificationChannelName;
  /** Provider message id (Twilio MessageSid / Resend inbound id) — the dedupe key. */
  providerMessageId: string;
  /** Raw sender from the SIGNATURE-VERIFIED webhook body. A claim, not an identity. */
  from: string;
  body: string;
  /** Email In-Reply-To (the Message-ID of the delivery this answers). SMS: none. */
  inReplyTo?: string;
  /** Email transport headers, for the automated-sender guard. SMS: undefined. */
  headers?: Record<string, string>;
}

export interface InboundDeps {
  /** Service-role client — the webhook has no session. Scoped per-user internally. */
  supabase: SupabaseClient;
  provider: AIProvider;
  getChannel: (name: NotificationChannelName) => NotificationChannel | null;
  now?: () => Date;
  /** Test seam: assert the assistant is (never) reached on the reject paths. */
  runAssistant?: typeof runAssistant;
}

export type InboundStatus = "processed" | "rejected" | "duplicate" | "failed";

export interface InboundResult {
  status: InboundStatus;
  reason?: string;
  /** What we replied (or tried to), for the route's logs and tests. */
  reply?: string;
}

/**
 * Detect a machine sender so we never reply to a reply. An auto-reply that
 * triggers an auto-reply is a billing incident and a spam complaint; these
 * headers are the standard way bulk/automated mail announces itself.
 */
export function isAutomatedSender(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;

  const autoSubmitted = (h["auto-submitted"] ?? "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true; // RFC 3834

  const precedence = (h["precedence"] ?? "").toLowerCase();
  if (["bulk", "list", "junk", "auto_reply"].includes(precedence)) return true;

  // A mailing-list / bulk-sender fingerprint.
  if (h["list-id"] || h["list-unsubscribe"]) return true;

  return false;
}

export async function processInbound(deps: InboundDeps, msg: InboundMessage): Promise<InboundResult> {
  const now = deps.now?.() ?? new Date();

  // 1. Idempotent audit row. The unique (channel, provider_message_id) index is
  //    the dedupe — a webhook retry (they are at-least-once) collides here and
  //    is dropped before any work, atomically under concurrency.
  const { data: inserted, error: insErr } = await deps.supabase
    .from("inbound_messages")
    .insert({
      channel: msg.channel,
      provider_message_id: msg.providerMessageId,
      body: msg.body,
      status: "received",
    })
    .select("id")
    .single();

  if (insErr) {
    if (insErr.code === "23505") return { status: "duplicate" };
    throw new Error(`Failed to record inbound message: ${insErr.message}`);
  }
  const inboundId = inserted.id as string;

  const finalize = async (
    status: InboundStatus,
    patch: Record<string, unknown> = {},
  ): Promise<void> => {
    const { error } = await deps.supabase
      .from("inbound_messages")
      .update({ status, processed_at: now.toISOString(), ...patch })
      .eq("id", inboundId);
    if (error) console.error(`${LOG_PREFIX} finalize ${status} failed for ${inboundId}: ${error.message}`);
  };

  // 2. Automated-sender guard — never answer a machine.
  if (isAutomatedSender(msg.headers)) {
    await finalize("rejected", { error: "automated sender" });
    return { status: "rejected", reason: "automated sender" };
  }

  // 3. Resolve sender → verified contact → user. A sender address is a claim;
  //    the ONLY thing that authenticates it is a verified, non-opted-out contact.
  const channel = deps.getChannel(msg.channel);
  const normalized = channel ? channel.normalizeAddress(msg.from) : { ok: true as const, address: msg.from };
  const address = normalized.ok ? normalized.address : msg.from.trim().toLowerCase();

  const { data: contacts, error: contactErr } = await deps.supabase
    .from("notification_contacts")
    .select("id, user_id, address")
    .eq("channel", msg.channel)
    .eq("address", address)
    .not("verified_at", "is", null)
    .is("opted_out_at", null);
  if (contactErr) throw new Error(`Failed to resolve inbound sender: ${contactErr.message}`);

  if (!contacts || contacts.length === 0) {
    await finalize("rejected", { error: "unknown or unverified sender" });
    return { status: "rejected", reason: "unknown or unverified sender" };
  }

  // A verified address mapping to more than one user is ambiguous identity (a
  // shared household email, a recycled phone number). Refusing is the only safe
  // move — picking one would execute writes as a guessed user.
  const distinctUsers = new Set(contacts.map((c) => c.user_id));
  if (distinctUsers.size > 1) {
    await finalize("rejected", { error: "ambiguous sender identity (address maps to multiple users)" });
    return { status: "rejected", reason: "ambiguous sender identity" };
  }

  const contact = contacts[0]!;
  const userId = contact.user_id as string;
  const replyAddress = contact.address as string; // reply to the STORED verified address, never msg.from
  await deps.supabase
    .from("inbound_messages")
    .update({ user_id: userId, contact_id: contact.id })
    .eq("id", inboundId);

  // 4. Rate-limit per contact, BEFORE the AI call. The just-inserted row is
  //    included in the count, so the thresholds are inclusive.
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const [minuteRes, hourRes] = await Promise.all([
    deps.supabase
      .from("inbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contact.id)
      .gte("created_at", minuteAgo),
    deps.supabase
      .from("inbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contact.id)
      .gte("created_at", hourAgo),
  ]);
  if (minuteRes.error) throw new Error(`Failed to read inbound rate (minute): ${minuteRes.error.message}`);
  if (hourRes.error) throw new Error(`Failed to read inbound rate (hour): ${hourRes.error.message}`);

  if ((minuteRes.count ?? 0) > MAX_PER_MINUTE || (hourRes.count ?? 0) > MAX_PER_HOUR) {
    await finalize("rejected", { error: "rate limited" });
    return { status: "rejected", reason: "rate limited" };
  }

  // 5. Scope the service client to this one user (the RLS a session would give)
  //    and load their profile.
  const scoped = scopedClient(deps.supabase, userId);
  const profile = await loadProfile(deps.supabase, userId);

  // 6. Thread: find the delivery this reply is answering, for context.
  const thread = await findThreadContext(deps.supabase, userId, contact.id, msg, now);

  // 7. Run the assistant with the INBOUND-scoped tool set — the security
  //    boundary is enforced in the executor, not just by this narrower prompt.
  const message = thread
    ? `Context — the notification the user is replying to said: "${thread.context}"\n\nThe user's reply: "${msg.body}"`
    : msg.body;

  const runFn = deps.runAssistant ?? runAssistant;
  let replyText: string;
  try {
    const response = await runFn(scoped, deps.provider, profile, message, { allowedTools: INBOUND_TOOLS });
    replyText = buildReplyText(response.text, (response.failures ?? []).map((f) => f.message));
  } catch (err) {
    console.error(`${LOG_PREFIX} assistant failed for ${inboundId}: ${err instanceof Error ? err.message : err}`);
    replyText = "Something went wrong on my end — try again in a moment, or open the app.";
    await sendReply(deps, msg.channel, replyAddress, replyText, inboundId, userId, profile.timezone, now);
    await finalize("failed", { error: "assistant error", in_reply_to_delivery_id: thread?.deliveryId ?? null });
    return { status: "failed", reason: "assistant error", reply: replyText };
  }

  // 8. Reply through the channel abstraction, and persist the exchange so a text
  //    thread and a ⌘K thread are one history.
  const sent = await sendReply(deps, msg.channel, replyAddress, replyText, inboundId, userId, profile.timezone, now);
  await recordExchange(scoped, userId, msg.body, replyText);

  await finalize(sent ? "processed" : "failed", {
    error: sent ? null : "reply send failed",
    in_reply_to_delivery_id: thread?.deliveryId ?? null,
  });
  return { status: sent ? "processed" : "failed", reply: replyText };
}

/** Fold deterministic tool failures into the text reply — never silent. */
function buildReplyText(text: string, failures: string[]): string {
  const base = text.trim() || "Done.";
  if (failures.length === 0) return base;
  // The web UI renders failures as red chips; over text they must be words, or
  // "I moved your 3pm" could mask a write that didn't happen.
  return `${base} (Couldn't: ${failures.join("; ")}.)`;
}

interface ThreadContext {
  deliveryId: string;
  context: string;
}

/**
 * The delivery a reply threads to. Email can reference the exact message via
 * In-Reply-To; SMS can't, so both fall back to "the most recent delivery to this
 * contact within THREAD_WINDOW_HOURS". The fallback is a heuristic and will
 * sometimes attach the wrong context — see the docs' failure-mode note.
 */
async function findThreadContext(
  supabase: SupabaseClient,
  userId: string,
  contactId: string,
  msg: InboundMessage,
  now: Date,
): Promise<ThreadContext | null> {
  // Email: try the exact delivery the client referenced first.
  if (msg.inReplyTo) {
    const { data } = await supabase
      .from("notification_deliveries")
      .select("id, kind, payload")
      .eq("provider_message_id", msg.inReplyTo)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return { deliveryId: data.id, context: summarizePayload(data.kind, data.payload) };
  }

  const windowStart = new Date(now.getTime() - THREAD_WINDOW_HOURS * 3_600_000).toISOString();
  const { data } = await supabase
    .from("notification_deliveries")
    .select("id, kind, payload, sent_at")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("status", "sent")
    .gte("sent_at", windowStart)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { deliveryId: data.id, context: summarizePayload(data.kind, data.payload) };
}

/** A short human summary of a delivery payload, to prime the assistant. */
function summarizePayload(kind: string, payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const key of ["message", "overview", "summary", "title"]) {
      if (typeof p[key] === "string" && p[key]) return String(p[key]).slice(0, 400);
    }
    if (Array.isArray(p.items)) {
      return (p.items as unknown[])
        .map((i) => (i && typeof i === "object" ? String((i as { line?: unknown }).line ?? "") : ""))
        .filter(Boolean)
        .join("; ")
        .slice(0, 400);
    }
  }
  return `a ${kind.replace("_", " ")} notification`;
}

/**
 * Send the reply through the existing channel abstraction, record it in the
 * delivery log, and count SMS spend — a reply is a message like any other. SMS
 * is segment-truncated; email carries a subject. Returns whether it left.
 */
async function sendReply(
  deps: InboundDeps,
  channelName: NotificationChannelName,
  to: string,
  text: string,
  inboundId: string,
  userId: string,
  timezone: string,
  now: Date,
): Promise<boolean> {
  const channel = deps.getChannel(channelName);
  if (!channel) {
    console.error(`${LOG_PREFIX} cannot reply: channel ${channelName} not configured`);
    return false;
  }

  const body = channelName === "sms" ? formatSmsReply(text).body : text;
  const result = await channel.send({
    to,
    subject: channelName === "email" ? "Re: your Caffeinatd assistant" : undefined,
    body,
    idempotencyKey: `inbound-reply:${inboundId}`,
  });

  // Log the reply as a delivery so it shows in the delivery log like any send,
  // and (SMS) counts against the spend cap — a reply is a message like any other.
  // Best-effort: a logging failure must not swallow the reply's own success.
  const { error: logErr } = await deps.supabase.from("notification_deliveries").insert({
    user_id: userId,
    kind: "system",
    channel: channelName,
    payload: { message: body, inbound_reply: true },
    status: result.ok ? "sent" : "failed",
    attempts: 1,
    sent_at: result.ok ? now.toISOString() : null,
    provider_message_id: result.providerMessageId ?? null,
    last_error: result.ok ? null : (result.error ?? "send failed"),
  });
  if (logErr) console.error(`${LOG_PREFIX} reply-delivery log failed for ${inboundId}: ${logErr.message}`);

  if (result.ok && channelName === "sms") {
    const { error } = await deps.supabase.rpc("increment_notification_spend", {
      p_user_id: userId,
      p_channel: "sms",
      p_period_start: localDay(now, timezone),
    });
    if (error) console.error(`${LOG_PREFIX} reply spend increment failed: ${error.message}`);
  }

  return result.ok;
}
