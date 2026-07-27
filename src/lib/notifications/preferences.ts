import { SupabaseClient } from "@supabase/supabase-js";
import {
  NotificationChannelName,
  NotificationKind,
  NOTIFICATION_KINDS,
} from "./types";

/**
 * The effective preference for one (user, kind): whether it fires at all and
 * which channels it may use. Defaults live here in code, not only in the DB, so
 * enqueue is correct on a brand-new account before any settings UI round-trip
 * and before the lazy seed has run — a stored row simply overrides the default.
 */
export interface EffectivePreference {
  kind: NotificationKind;
  enabled: boolean;
  channels: NotificationChannelName[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  digest: boolean;
  /** Per-user SMS cap overrides; null means "use the env default". */
  smsDailyCap: number | null;
  smsMonthlyCap: number | null;
  /** When an SMS is over cap, deliver it as email instead of dropping it. */
  downgradeToEmail: boolean;
}

/** Shape of a `notification_preferences` row (only the columns we read). */
export interface PreferenceRow {
  kind: string;
  enabled: boolean;
  channels: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  digest: boolean;
  sms_daily_cap: number | null;
  sms_monthly_cap: number | null;
  downgrade_to_email: boolean;
}

// Everything on, email-only, no quiet hours. Email is the one channel that
// needs no phone verification and carries no per-message charge, so it is the
// safe default; SMS is opt-in per kind once a phone is verified. Downgrade is on
// by default so an over-cap SMS still reaches the user by email.
function defaultFor(kind: NotificationKind): EffectivePreference {
  return {
    kind,
    enabled: true,
    channels: ["email"],
    quietHoursStart: null,
    quietHoursEnd: null,
    digest: false,
    smsDailyCap: null,
    smsMonthlyCap: null,
    downgradeToEmail: true,
  };
}

const KNOWN_CHANNELS: NotificationChannelName[] = ["email", "sms"];

function toEffective(kind: NotificationKind, row: PreferenceRow): EffectivePreference {
  const channels = row.channels.filter((c): c is NotificationChannelName =>
    (KNOWN_CHANNELS as string[]).includes(c),
  );
  return {
    kind,
    enabled: row.enabled,
    channels,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    digest: row.digest,
    smsDailyCap: row.sms_daily_cap ?? null,
    smsMonthlyCap: row.sms_monthly_cap ?? null,
    downgradeToEmail: row.downgrade_to_email ?? true,
  };
}

/**
 * Merge a user's stored preference rows over the code defaults for one kind.
 * Pure and unit-tested — enqueue's "skip disabled kind/channel" behavior is a
 * direct consequence of what this returns.
 */
export function resolvePreference(
  kind: NotificationKind,
  rows: PreferenceRow[],
): EffectivePreference {
  const row = rows.find((r) => r.kind === kind);
  return row ? toEffective(kind, row) : defaultFor(kind);
}

/**
 * Idempotently seed the default rows for kinds the user has no row for. An
 * optimization for the settings UI (so it renders real, editable rows), NOT a
 * correctness dependency of enqueue — hence `ignoreDuplicates`, so concurrent
 * callers racing the seed don't error. Follows the seed-on-first-visit pattern
 * in src/lib/workspaces/data.ts.
 */
export async function seedDefaultPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<EffectivePreference[]> {
  const rows = NOTIFICATION_KINDS.map((kind) => {
    const d = defaultFor(kind);
    return {
      user_id: userId,
      kind: d.kind,
      enabled: d.enabled,
      channels: d.channels,
      digest: d.digest,
    };
  });
  const { error } = await supabase
    .from("notification_preferences")
    .upsert(rows, { onConflict: "user_id,kind", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to seed notification preferences: ${error.message}`);
  return NOTIFICATION_KINDS.map((kind) => defaultFor(kind));
}
