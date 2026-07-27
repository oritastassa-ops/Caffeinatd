import { SupabaseClient } from "@supabase/supabase-js";
import { EffectivePreference, PreferenceRow, resolvePreference } from "./preferences";
import {
  capEnforced,
  CapUsage,
  evaluateCaps,
  localDay,
  monthRange,
  SmsCaps,
} from "./limits";
import { NotificationChannelName, NotificationKind } from "./types";

/** Shape of a `notification_contacts` row (only the columns enqueue reads). */
export interface ContactRow {
  id: string;
  channel: string;
  address: string;
  verified_at: string | null;
  opted_out_at: string | null;
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
 * The hard gates that belong here: the kind is enabled for a channel, and that
 * channel has a contact that is verified AND not opted out. Spend caps are
 * applied on top of this, in enqueue, because they need the clock and the DB.
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

/** The deliverable destination for a channel: primary first, else most recent. */
function pickContact(contacts: ContactRow[], channel: NotificationChannelName): ContactRow | null {
  const usable = contacts.filter(
    (c) => c.channel === channel && c.verified_at !== null && c.opted_out_at === null,
  );
  if (usable.length === 0) return null;
  usable.sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
  return usable[0] ?? null;
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
  /** Rows that are now queued to send — includes ones a prior call already queued. */
  queued: number;
  /** Reasons a channel produced no send (unverified / disabled / over cap). */
  skipped: string[];
}

const DEFAULT_SMS_DAILY_CAP = 10;
const DEFAULT_SMS_MONTHLY_CAP = 100;

// PostgREST surfaces a unique-constraint violation as SQLSTATE 23505.
const UNIQUE_VIOLATION = "23505";

interface FinalDelivery {
  channel: NotificationChannelName;
  contactId: string;
  address: string;
  status: "pending" | "skipped";
  lastError: string | null;
}

/**
 * The single entry point every pillar calls to reach the user off-app. Resolves
 * preferences → deliverable contacts → one `notification_deliveries` row per
 * channel, then applies SMS spend caps. No message is sent here.
 *
 * SMS caps are enforced HERE, not in the worker: queuing a message we'll refuse
 * to send just produces a `failed` row and a confused user. Over-cap SMS is
 * either downgraded to email (the better outcome — the user still gets the info)
 * or recorded as a `skipped` row for the audit log.
 *
 * Every Supabase call reads `error` and propagates it (docs/12 §A). The one
 * deliberate exception is a duplicate `dedupeKey`: the unique index rejecting it
 * means the row already exists — idempotent success, not failure.
 */
export async function enqueueNotification(
  supabase: SupabaseClient,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const { userId, kind, payload, dedupeKey, scheduledFor } = input;

  const { data: prefRows, error: prefErr } = await supabase
    .from("notification_preferences")
    .select("kind, enabled, channels, quiet_hours_start, quiet_hours_end, digest, sms_daily_cap, sms_monthly_cap, downgrade_to_email")
    .eq("user_id", userId);
  if (prefErr) throw new Error(`Failed to load notification preferences: ${prefErr.message}`);

  const { data: contactRows, error: contactErr } = await supabase
    .from("notification_contacts")
    .select("id, channel, address, verified_at, opted_out_at, is_primary, created_at")
    .eq("user_id", userId);
  if (contactErr) throw new Error(`Failed to load notification contacts: ${contactErr.message}`);

  const pref = resolvePreference(kind, (prefRows ?? []) as PreferenceRow[]);
  const contacts = (contactRows ?? []) as ContactRow[];
  const plan = planDeliveries(pref, contacts);
  const scheduled = scheduledFor ?? new Date();

  // Read SMS usage from the DB only when there's an SMS delivery under an active
  // cap; the decision itself is pure (planWithCaps) and unit-tested.
  const caps = resolveSmsCaps(pref);
  const hasSms = plan.deliveries.some((d) => d.channel === "sms");
  const enforce = hasSms && (capEnforced(caps.daily) || capEnforced(caps.monthly));
  const usage = enforce ? await readSmsUsage(supabase, userId, scheduled) : null;
  const { finals, skipped } = planWithCaps(plan, pref, contacts, usage, caps);

  const scheduledIso = scheduled.toISOString();
  let queued = 0;

  // One insert per channel so a dedupe conflict on one channel doesn't block the
  // others — a batch insert is all-or-nothing under the unique index.
  for (const delivery of finals) {
    const { error } = await supabase.from("notification_deliveries").insert({
      user_id: userId,
      kind,
      channel: delivery.channel,
      contact_id: delivery.contactId,
      payload,
      dedupe_key: dedupeKey ?? null,
      status: delivery.status,
      attempts: 0,
      scheduled_for: scheduledIso,
      last_error: delivery.lastError,
    });

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        if (delivery.status === "pending") queued += 1; // already queued — idempotent
        continue;
      }
      throw new Error(`Failed to enqueue ${delivery.channel} notification: ${error.message}`);
    }
    if (delivery.status === "pending") queued += 1;
  }

  return { queued, skipped };
}

/**
 * Transform the planned deliveries under SMS spend caps — PURE, so the cap /
 * downgrade / skip branches are unit-tested directly. `usage` is null when no
 * cap is active (no SMS, or caps disabled), in which case every delivery passes
 * through as pending.
 *
 * Over-cap SMS is, in order of preference: dropped if email is already queued
 * (the info still arrives), downgraded to a verified email if downgrade is on,
 * else recorded as a `skipped` audit row.
 */
export function planWithCaps(
  plan: DeliveryPlan,
  pref: EffectivePreference,
  contacts: ContactRow[],
  usage: CapUsage | null,
  caps: SmsCaps,
): { finals: FinalDelivery[]; skipped: string[] } {
  const skipped = [...plan.skipped];
  const finals: FinalDelivery[] = [];
  // Copy so the pure function doesn't mutate the caller's usage object.
  const running: CapUsage | null = usage ? { ...usage } : null;

  for (const d of plan.deliveries) {
    if (d.channel !== "sms" || !running) {
      finals.push({ ...d, status: "pending", lastError: null });
      continue;
    }

    const decision = evaluateCaps(running, caps);
    if (!decision.blocked) {
      running.inFlight += 1; // this SMS is now in-flight; count it against a 2nd in the same call
      finals.push({ ...d, status: "pending", lastError: null });
      continue;
    }

    const reason = `sms: ${decision.reason} spend cap reached`;
    const emailAlready =
      finals.some((f) => f.channel === "email") || plan.deliveries.some((x) => x.channel === "email");

    if (pref.downgradeToEmail && emailAlready) {
      skipped.push(`${reason} → email already queued`);
      continue;
    }
    if (pref.downgradeToEmail) {
      const email = pickContact(contacts, "email");
      if (email) {
        finals.push({ channel: "email", contactId: email.id, address: email.address, status: "pending", lastError: null });
        skipped.push(`${reason} → downgraded to email`);
        continue;
      }
    }

    // No downgrade, or nowhere to downgrade to: a skipped row is the audit record.
    finals.push({ ...d, status: "skipped", lastError: reason });
    skipped.push(reason);
  }

  return { finals, skipped };
}

function intOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function resolveSmsCaps(pref: EffectivePreference): SmsCaps {
  return {
    daily: pref.smsDailyCap ?? intOrNull(process.env.SMS_DAILY_CAP) ?? DEFAULT_SMS_DAILY_CAP,
    monthly: pref.smsMonthlyCap ?? intOrNull(process.env.SMS_MONTHLY_CAP) ?? DEFAULT_SMS_MONTHLY_CAP,
  };
}

async function getUserTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle<{ timezone: string | null }>();
  return data?.timezone || "UTC";
}

async function readSmsUsage(supabase: SupabaseClient, userId: string, now: Date): Promise<CapUsage> {
  const tz = await getUserTimezone(supabase, userId);
  const day = localDay(now, tz);
  const { start, endExclusive } = monthRange(now, tz);

  const [todayRes, monthRes, inFlightRes] = await Promise.all([
    supabase
      .from("notification_spend")
      .select("sent_count")
      .eq("user_id", userId)
      .eq("channel", "sms")
      .eq("period_start", day)
      .maybeSingle<{ sent_count: number }>(),
    supabase
      .from("notification_spend")
      .select("sent_count")
      .eq("user_id", userId)
      .eq("channel", "sms")
      .gte("period_start", start)
      .lt("period_start", endExclusive),
    supabase
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("channel", "sms")
      .in("status", ["pending", "sending"]),
  ]);

  if (todayRes.error) throw new Error(`Failed to read SMS daily spend: ${todayRes.error.message}`);
  if (monthRes.error) throw new Error(`Failed to read SMS monthly spend: ${monthRes.error.message}`);
  if (inFlightRes.error) throw new Error(`Failed to read in-flight SMS: ${inFlightRes.error.message}`);

  const sentMonth = (monthRes.data ?? []).reduce(
    (sum, r) => sum + ((r as { sent_count: number }).sent_count ?? 0),
    0,
  );
  return {
    sentToday: todayRes.data?.sent_count ?? 0,
    sentMonth,
    inFlight: inFlightRes.count ?? 0,
  };
}
