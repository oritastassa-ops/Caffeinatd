import { SupabaseClient } from "@supabase/supabase-js";
import { resolveOutcome } from "./backoff";
import { renderEmail } from "./templates";
import { signUnsubscribe } from "./unsubscribe";
import { NotificationChannel, NotificationChannelName, NotificationKind } from "./types";

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
  now?: () => Date;
}

export interface WorkerSummary {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
}

interface ClaimableRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  channel: NotificationChannelName;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  attempts: number;
  contact: { address: string } | null;
}

const SELECT =
  "id, user_id, kind, channel, payload, dedupe_key, attempts, contact:notification_contacts(address)";

export async function runWorker(supabase: SupabaseClient, deps: WorkerDeps): Promise<WorkerSummary> {
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const leaseIso = new Date(now.getTime() + deps.leaseMs).toISOString();
  const summary: WorkerSummary = { claimed: 0, sent: 0, failed: 0, retried: 0 };

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

    await processClaimed(supabase, deps, row, now, summary);
  }

  return summary;
}

async function processClaimed(
  supabase: SupabaseClient,
  deps: WorkerDeps,
  row: ClaimableRow,
  now: Date,
  summary: WorkerSummary,
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
    rendered = renderEmail(row.kind, row.payload, { unsubscribeUrl });
  } catch (err) {
    return fail(`template error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!rendered) return fail(`no email template for kind ${row.kind}`);

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

  const outcome = resolveOutcome(result, row.attempts);
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
