import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { getChannel } from "@/lib/notifications/registry";
import { renderEmail } from "@/lib/notifications/templates";
import { signUnsubscribe } from "@/lib/notifications/unsubscribe";
import { testSendBlocked, TEST_SEND_WINDOW_MS } from "@/lib/notifications/matrix";

const bodySchema = z.object({ channel: z.enum(["email", "sms"]) });

/**
 * Sends a REAL test message on a channel, synchronously, and records it in the
 * delivery log. This is the highest-value affordance on the settings page — it
 * turns "I think it's set up" into "it works". Rate-limited (test rows are keyed
 * `test:<user>:…`, counted over a window) so it can't be turned into a send loop.
 */
export async function POST(req: NextRequest) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { supabase, user } = userCtx;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a channel." }, { status: 400 });
  const channel = parsed.data.channel;

  // Rate limit.
  const windowStart = new Date(Date.now() - TEST_SEND_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .like("dedupe_key", "test:%")
    .gte("created_at", windowStart);
  if (testSendBlocked(count ?? 0)) {
    return NextResponse.json({ error: "You've sent several test messages just now — try again in a few minutes." }, { status: 429 });
  }

  const impl = getChannel(channel);
  if (!impl) {
    return NextResponse.json({ error: `${channel === "sms" ? "SMS" : "Email"} isn't configured on this server.` }, { status: 400 });
  }

  // A verified, non-opted-out contact for the channel.
  const { data: contact, error: contactErr } = await supabase
    .from("notification_contacts")
    .select("id, address")
    .eq("user_id", user.id)
    .eq("channel", channel)
    .not("verified_at", "is", null)
    .is("opted_out_at", null)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; address: string }>();
  if (contactErr) return NextResponse.json({ error: "Couldn't look up your contacts." }, { status: 500 });
  if (!contact) {
    return NextResponse.json({ error: `No verified ${channel === "sms" ? "phone number" : "email"} to test.` }, { status: 400 });
  }

  const message = `This is a test from Caffeinatd. If you're reading this, your ${channel === "sms" ? "SMS" : "email"} notifications are working.`;
  const idempotencyKey = `test:${user.id}:${Date.now()}`;
  const unsubscribeUrl = `${process.env.APP_URL ?? ""}/api/notifications/unsubscribe?token=${signUnsubscribe(user.id, "system")}`;
  const email = renderEmail("system", { message }, { unsubscribeUrl });

  const result = await impl.send({
    to: contact.address,
    subject: email?.subject ?? "Caffeinatd test",
    body: email?.text ?? message,
    html: email?.html,
    idempotencyKey,
  });

  // Record it so it shows in the delivery log like any other send.
  const now = new Date().toISOString();
  const { error: insertErr } = await supabase.from("notification_deliveries").insert({
    user_id: user.id,
    kind: "system",
    channel,
    contact_id: contact.id,
    payload: { test: true, message },
    dedupe_key: idempotencyKey,
    status: result.ok ? "sent" : "failed",
    attempts: 1,
    scheduled_for: now,
    sent_at: result.ok ? now : null,
    provider_message_id: result.providerMessageId ?? null,
    last_error: result.ok ? null : (result.error ?? "send failed"),
  });
  if (insertErr) {
    // The message may have sent; just couldn't log it. Say so honestly.
    return NextResponse.json({ ok: result.ok, error: result.ok ? undefined : result.error, logged: false });
  }

  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: result.error ?? "The test message couldn't be delivered." }, { status: 502 });
}
