import { SupabaseClient } from "@supabase/supabase-js";
import { resolveOutcome } from "./backoff";
import { localDay } from "./limits";
import { renderEmail } from "./templates";
import { signUnsubscribe } from "./unsubscribe";
import {
  ContactAction,
  NotificationChannel,
  NotificationChannelName,
  NotificationKind,
} from "./types";

/**
 * Drains the `notification_deliveries` queue. Extracted from the cron route so
 * the claim → send → finalize loop is testable against a fake Supabase and a
 * fake channel. Cross-user by design: it drains the whole queue, so it runs on
 * the service client (RLS bypassed) — the opposite of enqueue, which is
 * per-user.
 */

const LOG_PREFIX = "[notifications:worker]";

export interface WorkerDeps {
  getChannel: (name: NotificationChannelName) => NotificationChannel | null;
  batchSize: number;
  /** How long a claimed ('sending') row is invisible before it can be reclaimed. */
  leaseMs: number;
  appUrl: string;
  /** Global backstop: max SMS actually sent per run, defends against a runaway loop. */
  smsMaxPerRun?: number;
  now?: () => Date;
}

export interface WorkerSummary {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  /** SMS deferred to a later run because the per-run global cap was hit. */
  smsDeferred: number;
}

interface ClaimableRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  channel: NotificationChannelName;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  attempts: number;
  contact_id: string | null;
  contact: { address: string } | null;
}

/** Mutable per-run state threaded through the loop (SMS counting). */
interface RunState {
  smsSent: number;
  tzCache: Map<string, string>;
}

const SELECT =
  "id, user_id, kind, channel, payload, dedupe_key, attempts, contact_id, contact:notification_contacts(address)";

export async function runWorker(supabase: SupabaseClient, deps: WorkerDeps): Promise<WorkerSummary> {
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const leaseIso = new Date(now.getTime() + deps.leaseMs).toISOString();
  const summary: WorkerSummary = { claimed: 0, sent: 0, failed: 0, retried: 0, smsDeferred: 0 };
  const state: RunState = { smsSent: 0, tzCache: new Map() };
  const smsMaxPerRun = deps.smsMaxPerRun ?? Number.POSITIVE_INFINITY;

  // 1. Reclaim leases that expired (a serverless timeout mid-send). A claimed
  //    row's scheduled_for is set to now+lease (future), so only genuinely
  //    stranded rows match `<= now`.
  const { error: reclaimErr } = await supabase
    .from("notification_deliveries")
    .update({ status: "pending" })
    .eq("status", "sending")
    .lte("scheduled_for", nowIso);
  if (reclaimErr) console.error(`${LOG_PREFIX} reclaim failed: ${reclaimErr.message}`);

  // 2. Candidate pending rows, oldest first, bounded by the batch size.
  const { data: rows, error: selectErr } = await supabase
    .from("notification_deliveries")
    .select(SELECT)
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(deps.batchSize);
  if (selectErr) {
    console.error(`${LOG_PREFIX} select failed: ${selectErr.message}`);
    return summary;
  }

  for (const row of (rows ?? []) as unknown as ClaimableRow[]) {
    // Per-run SMS backstop: leave over-cap SMS pending for the next run rather
    // than sending it now. Checked before claiming so the row stays claimable.
    if (row.channel === "sms" && state.smsSent >= smsMaxPerRun) {
      summary.smsDeferred += 1;
      continue;
    }

    // 3. Claim atomically: only the invocation whose conditional update flips
    //    pending→sending owns the row. A racing cron gets 0 rows back and skips.
    const { data: claimed, error: claimErr } = await supabase
      .from("notification_deliveries")
      .update({ status: "sending", scheduled_for: leaseIso })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (claimErr) {
      console.error(`${LOG_PREFIX} claim failed for ${row.id}: ${claimErr.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) continue; // lost the race
    summary.claimed += 1;

    await processClaimed(supabase, deps, row, now, summary, state);
  }

  return summary;
}

async function processClaimed(
  supabase: SupabaseClient,
  deps: WorkerDeps,
  row: ClaimableRow,
  now: Date,
  summary: WorkerSummary,
  state: RunState,
): Promise<void> {
  const fail = (last_error: string) =>
    finalize(supabase, row.id, { status: "failed", attempts: row.attempts + 1 }, now, last_error, summary);

  const channel = deps.getChannel(row.channel);
  if (!channel) return fail(`channel ${row.channel} not configured`);

  const address = row.contact?.address;
  if (!address) return fail("contact has no address (removed?)");

  const unsubscribeUrl = `${deps.appUrl}/api/notifications/unsubscribe?token=${signUnsubscribe(row.user_id, row.kind)}`;
  let rendered;
  try {
    // The same template drives both channels: email uses html, SMS uses text.
    rendered = renderEmail(row.kind, row.payload, { unsubscribeUrl });
  } catch (err) {
    return fail(`template error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!rendered) return fail(`no template for kind ${row.kind}`);

  const result = await channel.send({
    to: address,
    subject: rendered.subject,
    body: rendered.text,
    html: rendered.html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: row.dedupe_key ?? row.id,
  });

  // A send outcome can demand a durable change to the contact itself (SMS opt-out
  // or invalid number) — apply it before finalizing the delivery.
  if (result.contactAction && row.contact_id) {
    await applyContactAction(supabase, row.contact_id, result.contactAction, now);
  }

  const outcome = resolveOutcome(result, row.attempts);

  // Count spend on SENT only, so retries of a failed send don't double-count.
  if (outcome.status === "sent" && row.channel === "sms") {
    state.smsSent += 1;
    await incrementSmsSpend(supabase, row.user_id, now, state);
  }

  await finalize(
    supabase,
    row.id,
    outcome,
    now,
    result.ok ? null : (result.error ?? "send failed"),
    summary,
    result.providerMessageId,
  );
}

async function applyContactAction(
  supabase: SupabaseClient,
  contactId: string,
  action: ContactAction,
  now: Date,
): Promise<void> {
  // opt_out: never message this number again until an inbound START clears it.
  // invalidate: the number isn't a valid mobile — drop verification so it must
  // be re-verified before any future send.
  const patch =
    action === "opt_out"
      ? { opted_out_at: now.toISOString() }
      : { verified_at: null };
  const { error } = await supabase.from("notification_contacts").update(patch).eq("id", contactId);
  if (error) console.error(`${LOG_PREFIX} contact ${action} failed for ${contactId}: ${error.message}`);
}

async function incrementSmsSpend(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
  state: RunState,
): Promise<void> {
  const tz = await userTimezone(supabase, userId, state);
  const { error } = await supabase.rpc("increment_notification_spend", {
    p_user_id: userId,
    p_channel: "sms",
    p_period_start: localDay(now, tz),
  });
  if (error) console.error(`${LOG_PREFIX} spend increment failed for ${userId}: ${error.message}`);
}

async function userTimezone(supabase: SupabaseClient, userId: string, state: RunState): Promise<string> {
  const cached = state.tzCache.get(userId);
  if (cached) return cached;
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle<{ timezone: string | null }>();
  const tz = data?.timezone || "UTC";
  state.tzCache.set(userId, tz);
  return tz;
}

async function finalize(
  supabase: SupabaseClient,
  id: string,
  outcome: { status: "sent" | "pending" | "failed"; attempts: number; retryDelayMs?: number },
  now: Date,
  lastError: string | null,
  summary: WorkerSummary,
  providerMessageId?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status: outcome.status, attempts: outcome.attempts };

  if (outcome.status === "sent") {
    patch.sent_at = now.toISOString();
    patch.provider_message_id = providerMessageId ?? null;
    patch.last_error = null;
    summary.sent += 1;
  } else if (outcome.status === "pending") {
    patch.scheduled_for = new Date(now.getTime() + (outcome.retryDelayMs ?? 0)).toISOString();
    patch.last_error = lastError;
    summary.retried += 1;
  } else {
    patch.last_error = lastError;
    summary.failed += 1;
  }

  const { error } = await supabase.from("notification_deliveries").update(patch).eq("id", id);
  if (error) console.error(`${LOG_PREFIX} finalize ${outcome.status} failed for ${id}: ${error.message}`);
}
