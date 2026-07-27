import { SupabaseClient } from "@supabase/supabase-js";
import { EffectivePreference, PreferenceRow, resolvePreference } from "./preferences";
import { NotificationChannelName, NotificationKind } from "./types";

/** Shape of a `notification_contacts` row (only the columns enqueue reads). */
export interface ContactRow {
  id: string;
  channel: string;
  address: string;
  verified_at: string | null;
  is_primary: boolean;
  created_at: string;
}

/** One resolved delivery: which verified contact receives this on which channel. */
export interface PlannedDelivery {
  channel: NotificationChannelName;
  contactId: string;
  address: string;
}

export interface DeliveryPlan {
  deliveries: PlannedDelivery[];
  /** Human-readable reason strings for every channel that produced no row. */
  skipped: string[];
}

/**
 * Decide, from a resolved preference and the user's contacts, which deliveries
 * to create. Pure — no DB, no clock, no env — so the "skip unverified" and
 * "skip disabled" rules are unit-tested directly instead of through a mock.
 *
 * The two hard gates are the only ones that belong here: the kind must be
 * enabled for a channel, and that channel must have a verified contact. Whether
 * a vendor is configured is a *send-time* concern (Phase 4's worker), not an
 * enqueue concern — so the queue faithfully records intent even for a channel
 * whose provider isn't wired yet.
 */
export function planDeliveries(
  pref: EffectivePreference,
  contacts: ContactRow[],
): DeliveryPlan {
  if (!pref.enabled) {
    return { deliveries: [], skipped: [`${pref.kind}: notifications disabled for this kind`] };
  }

  const deliveries: PlannedDelivery[] = [];
  const skipped: string[] = [];

  for (const channel of dedupe(pref.channels)) {
    const contact = pickContact(contacts, channel);
    if (!contact) {
      skipped.push(`${channel}: no verified contact`);
      continue;
    }
    deliveries.push({ channel, contactId: contact.id, address: contact.address });
  }

  return { deliveries, skipped };
}

/** The verified destination for a channel: primary first, else most recent. */
function pickContact(contacts: ContactRow[], channel: NotificationChannelName): ContactRow | null {
  const verified = contacts.filter((c) => c.channel === channel && c.verified_at !== null);
  if (verified.length === 0) return null;
  verified.sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
  return verified[0] ?? null;
}

function dedupe(channels: NotificationChannelName[]): NotificationChannelName[] {
  return [...new Set(channels)];
}

export interface EnqueueInput {
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  /** Stable key that makes re-enqueuing the same logical event a no-op. */
  dedupeKey?: string;
  /** When the send worker may deliver this; defaults to now. */
  scheduledFor?: Date;
}

export interface EnqueueResult {
  /** Rows that are now queued — includes ones a prior call already queued. */
  queued: number;
  /** Reasons a channel produced no row (unverified / disabled). */
  skipped: string[];
}

// PostgREST surfaces a unique-constraint violation as SQLSTATE 23505.
const UNIQUE_VIOLATION = "23505";

/**
 * The single entry point every pillar calls to reach the user off-app. Resolves
 * preferences → verified contacts → one `notification_deliveries` row per
 * channel. No message is sent here; a 'pending' row is the send worker's input.
 *
 * Every Supabase call reads `error` and propagates it — the repo's highest-value
 * rule (docs/12-quality-audit.md §A). The one deliberate exception is a duplicate
 * `dedupeKey`: the unique index rejecting it means the row already exists, which
 * is success (idempotent), not failure — so that specific conflict is swallowed.
 */
export async function enqueueNotification(
  supabase: SupabaseClient,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const { userId, kind, payload, dedupeKey, scheduledFor } = input;

  const { data: prefRows, error: prefErr } = await supabase
    .from("notification_preferences")
    .select("kind, enabled, channels, quiet_hours_start, quiet_hours_end, digest")
    .eq("user_id", userId);
  if (prefErr) throw new Error(`Failed to load notification preferences: ${prefErr.message}`);

  const { data: contactRows, error: contactErr } = await supabase
    .from("notification_contacts")
    .select("id, channel, address, verified_at, is_primary, created_at")
    .eq("user_id", userId);
  if (contactErr) throw new Error(`Failed to load notification contacts: ${contactErr.message}`);

  const pref = resolvePreference(kind, (prefRows ?? []) as PreferenceRow[]);
  const plan = planDeliveries(pref, (contactRows ?? []) as ContactRow[]);

  const scheduledIso = (scheduledFor ?? new Date()).toISOString();
  let queued = 0;

  // One insert per channel so a dedupe conflict on one channel doesn't block the
  // others — a batch insert is all-or-nothing under the unique index.
  for (const delivery of plan.deliveries) {
    const { error } = await supabase.from("notification_deliveries").insert({
      user_id: userId,
      kind,
      channel: delivery.channel,
      contact_id: delivery.contactId,
      payload,
      dedupe_key: dedupeKey ?? null,
      status: "pending",
      attempts: 0,
      scheduled_for: scheduledIso,
    });

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        queued += 1; // Already queued by an earlier call — idempotent success.
        continue;
      }
      throw new Error(`Failed to enqueue ${delivery.channel} notification: ${error.message}`);
    }
    queued += 1;
  }

  return { queued, skipped: plan.skipped };
}
