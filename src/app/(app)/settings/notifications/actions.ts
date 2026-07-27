"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { NOTIFICATION_KINDS, NotificationKind } from "@/lib/notifications/types";

/** One kind's saved preferences, as the settings form posts them back. */
export interface KindPreferenceInput {
  kind: NotificationKind;
  enabled: boolean;
  channels: string[];
  digest: boolean;
}

export interface SavePreferencesInput {
  kinds: KindPreferenceInput[];
  /** Applied to every kind (quiet hours are one control in the UI). */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  smsDailyCap: number | null;
  smsMonthlyCap: number | null;
}

/**
 * Upserts all of a user's notification preference rows in one call — the page
 * holds the whole matrix in local state and saves it, matching the Profile
 * form's single-Save pattern. Channel/kind values are validated against the
 * known enums so a tampered post can't write junk.
 */
export async function saveNotificationPreferences(input: SavePreferencesInput) {
  const { supabase, user } = await requireUser();

  const validKind = (k: string): k is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(k);
  const cleanChannels = (chs: string[]) => chs.filter((c) => c === "email" || c === "sms");

  const rows = input.kinds
    .filter((k) => validKind(k.kind))
    .map((k) => ({
      user_id: user.id,
      kind: k.kind,
      enabled: k.enabled,
      channels: cleanChannels(k.channels),
      digest: k.digest,
      quiet_hours_start: input.quietHoursStart,
      quiet_hours_end: input.quietHoursEnd,
      sms_daily_cap: input.smsDailyCap,
      sms_monthly_cap: input.smsMonthlyCap,
      updated_at: new Date().toISOString(),
    }));

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(rows, { onConflict: "user_id,kind" });
  if (error) return { ok: false as const, error: "Couldn't save your preferences." };

  revalidatePath("/settings/notifications");
  return { ok: true as const };
}
