import { SupabaseClient } from "@supabase/supabase-js";
import { enqueueNotification } from "./enqueue";
import { NotificationChannelName } from "./types";

/**
 * Turns due `reminders` rows into notification deliveries. The `reminders` table
 * has existed since migration 002 and was never dispatched; this is the wiring.
 * Cross-user by design (service client), run from the notifications cron every 5
 * minutes — one queue drainer, not a second cron.
 *
 * Idempotency is layered: the delivery dedupe key `reminder:<id>` means a
 * re-enqueue can't double-send even if `dispatched_at` didn't get written (a
 * crash between enqueue and the update); `dispatched_at` is just the optimization
 * that stops us re-scanning handled reminders each run.
 */

const LOG_PREFIX = "[notifications:reminders]";
const BATCH = 200;

interface DueReminder {
  id: string;
  user_id: string;
  message: string;
  remind_at: string;
  notification_type: "auto" | "email" | "sms" | "in_app";
  urgent: boolean;
}

export interface DispatchSummary {
  dispatched: number;
  failed: number;
}

export async function dispatchDueReminders(supabase: SupabaseClient): Promise<DispatchSummary> {
  const nowIso = new Date().toISOString();
  const summary: DispatchSummary = { dispatched: 0, failed: 0 };

  // Due, not completed, not already dispatched, and wants off-app delivery
  // ('in_app' reminders only surface in the app — never queued here).
  const { data: reminders, error } = await supabase
    .from("reminders")
    .select("id, user_id, message, remind_at, notification_type, urgent")
    .lte("remind_at", nowIso)
    .is("completed_at", null)
    .is("dispatched_at", null)
    .neq("notification_type", "in_app")
    .order("remind_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error(`${LOG_PREFIX} select failed: ${error.message}`);
    return summary;
  }

  for (const r of (reminders ?? []) as DueReminder[]) {
    try {
      // 'auto' → let preferences pick channels; a specific type forces it.
      const channelOverride: NotificationChannelName | undefined =
        r.notification_type === "email" || r.notification_type === "sms" ? r.notification_type : undefined;

      await enqueueNotification(supabase, {
        userId: r.user_id,
        kind: "reminder",
        payload: { message: r.message, remindAt: r.remind_at },
        dedupeKey: `reminder:${r.id}`,
        scheduledFor: new Date(r.remind_at), // quiet hours applied inside enqueue
        channelOverride,
        urgent: r.urgent,
        digestLine: r.message,
      });

      // Mark handled so we don't re-scan it. Idempotent enqueue makes a failure
      // here harmless (next run re-enqueues, dedupe collapses it).
      const { error: markErr } = await supabase
        .from("reminders")
        .update({ dispatched_at: nowIso })
        .eq("id", r.id);
      if (markErr) console.error(`${LOG_PREFIX} mark dispatched failed for ${r.id}: ${markErr.message}`);

      summary.dispatched += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`${LOG_PREFIX} enqueue failed for ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return summary;
}
