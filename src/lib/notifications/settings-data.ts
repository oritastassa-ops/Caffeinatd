import { SupabaseClient } from "@supabase/supabase-js";
import { availableChannels } from "./registry";
import { maskAddress } from "./mask";
import { resolvePreference, PreferenceRow, EffectivePreference } from "./preferences";
import {
  NotificationChannelName,
  NotificationKind,
  NOTIFICATION_KINDS,
} from "./types";

/** Everything the notifications settings page needs, in one round of queries. */

export interface ContactView {
  id: string;
  channel: NotificationChannelName;
  address: string;
  masked: string;
  label: string | null;
  verified: boolean;
  optedOut: boolean;
  createdAt: string;
}

export interface DeliveryView {
  id: string;
  kind: NotificationKind;
  channel: NotificationChannelName;
  destination: string | null; // masked
  status: string;
  error: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationSettings {
  contacts: ContactView[];
  /** Resolved preference per kind (defaults merged over stored rows). */
  preferences: EffectivePreference[];
  deliveries: DeliveryView[];
  /** Channels this server can actually send on (registry). */
  configuredChannels: NotificationChannelName[];
  /** Channels the user has a verified, non-opted-out contact for. */
  verifiedChannels: NotificationChannelName[];
}

interface RawContact {
  id: string;
  channel: string;
  address: string;
  label: string | null;
  verified_at: string | null;
  opted_out_at: string | null;
  created_at: string;
}

interface RawDelivery {
  id: string;
  kind: string;
  channel: string;
  payload: Record<string, unknown> | null;
  status: string;
  last_error: string | null;
  scheduled_for: string;
  sent_at: string | null;
  created_at: string;
  contact: { channel: string; address: string } | null;
}

export async function loadNotificationSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<NotificationSettings> {
  const [contactsRes, prefsRes, deliveriesRes] = await Promise.all([
    supabase
      .from("notification_contacts")
      .select("id, channel, address, label, verified_at, opted_out_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("notification_preferences")
      .select("kind, enabled, channels, quiet_hours_start, quiet_hours_end, digest, sms_daily_cap, sms_monthly_cap, downgrade_to_email")
      .eq("user_id", userId),
    supabase
      .from("notification_deliveries")
      .select("id, kind, channel, payload, status, last_error, scheduled_for, sent_at, created_at, contact:notification_contacts(channel, address)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const rawContacts = (contactsRes.data ?? []) as RawContact[];
  const contacts: ContactView[] = rawContacts.map((c) => {
    const channel = c.channel as NotificationChannelName;
    return {
      id: c.id,
      channel,
      address: c.address,
      masked: maskAddress(channel, c.address),
      label: c.label,
      verified: c.verified_at !== null,
      optedOut: c.opted_out_at !== null,
      createdAt: c.created_at,
    };
  });

  const prefRows = (prefsRes.data ?? []) as PreferenceRow[];
  const preferences = NOTIFICATION_KINDS.map((kind) => resolvePreference(kind, prefRows));

  const deliveries: DeliveryView[] = ((deliveriesRes.data ?? []) as unknown as RawDelivery[]).map((d) => {
    const channel = d.channel as NotificationChannelName;
    // A digest/test row may have no contact join; fall back to nothing rather than guess.
    const destination = d.contact
      ? maskAddress(d.contact.channel as NotificationChannelName, d.contact.address)
      : null;
    return {
      id: d.id,
      kind: d.kind as NotificationKind,
      channel,
      destination,
      status: d.status,
      // last_error is contractually user-safe (Phases 2–3: channels never return a
      // raw provider body), so it is safe to render directly.
      error: d.last_error,
      scheduledFor: d.scheduled_for,
      sentAt: d.sent_at,
      createdAt: d.created_at,
    };
  });

  const configuredChannels = availableChannels();
  const verifiedChannels = [...new Set(
    contacts.filter((c) => c.verified && !c.optedOut).map((c) => c.channel),
  )];

  return { contacts, preferences, deliveries, configuredChannels, verifiedChannels };
}

/**
 * Channels the user can ACTUALLY be reached on right now: configured on the
 * server AND with a verified, non-opted-out contact. The assistant uses this to
 * stop offering to text someone with no verified number. Lightweight (one query)
 * because it's on the assistant hot path.
 */
export async function reachableChannels(
  supabase: SupabaseClient,
  userId: string,
): Promise<NotificationChannelName[]> {
  const configured = new Set(availableChannels());
  const { data } = await supabase
    .from("notification_contacts")
    .select("channel")
    .eq("user_id", userId)
    .not("verified_at", "is", null)
    .is("opted_out_at", null);
  const verified = new Set(((data ?? []) as { channel: string }[]).map((c) => c.channel));
  return [...configured].filter((c) => verified.has(c));
}
