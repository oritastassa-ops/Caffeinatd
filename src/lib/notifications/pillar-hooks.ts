import { SupabaseClient } from "@supabase/supabase-js";
import { Profile, WeeklyFinanceReview } from "@/lib/types";
import { money } from "@/lib/finance/format";
import { CreatedInsight } from "@/lib/insights/generate";
import { enqueueNotification } from "./enqueue";
import { NotificationKind } from "./types";

/**
 * The seams where a pillar that just computed something worth knowing hands it
 * to the notification layer. Every call is guarded so a notification failure
 * never breaks the pillar — the same rule as the daily-plan enqueue (Phase 2).
 */

const LOG_PREFIX = "[notifications:hooks]";

/** A missed-week/consistency insight becomes a fitness_nudge; the rest are insights. */
function kindForInsight(dedupKey: string): NotificationKind {
  return dedupKey.startsWith("fitness:missed_week") ? "fitness_nudge" : "insight";
}

/**
 * Notify on genuinely new insights only. `insights` is what ensureInsights
 * actually inserted this run, so re-running the rules never re-notifies; the
 * dedupe key on the insight id is the second guard against double-send.
 */
export async function notifyNewInsights(
  supabase: SupabaseClient,
  userId: string,
  insights: CreatedInsight[],
): Promise<void> {
  for (const insight of insights) {
    const kind = kindForInsight(insight.dedup_key);
    try {
      await enqueueNotification(supabase, {
        userId,
        kind,
        payload: { message: insight.message },
        dedupeKey: `${kind}:${insight.id}`,
        digestLine: insight.message,
      });
    } catch (err) {
      console.error(`${LOG_PREFIX} ${kind} enqueue failed for ${insight.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

/** Notify when a weekly finance review is generated. Once per user per week. */
export async function notifyFinanceReview(
  supabase: SupabaseClient,
  profile: Profile,
  weekStart: string,
  review: WeeklyFinanceReview,
): Promise<void> {
  const highlights = [
    `Income ${money(review.income)}, expenses ${money(review.expenses)}`,
    `Savings rate ${review.savingsRate}%`,
    ...(review.netWorthChange !== null ? [`Net worth change ${money(review.netWorthChange)}`] : []),
  ];
  try {
    await enqueueNotification(supabase, {
      userId: profile.id,
      kind: "finance_review",
      payload: { name: profile.display_name, weekStart, summary: review.narrative, highlights },
      dedupeKey: `finance_review:${profile.id}:${weekStart}`,
      digestLine: `Weekly finance review for ${weekStart}`,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} finance_review enqueue failed for ${profile.id}:`, err instanceof Error ? err.message : err);
  }
}
