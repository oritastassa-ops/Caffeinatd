import { SupabaseClient } from "@supabase/supabase-js";

/**
 * A per-user scope over the service-role client. The service client bypasses RLS
 * (it has to — cron and inbound webhooks have no user session), so this Proxy
 * puts back the one guarantee RLS gives session clients: every read of a
 * user-owned table is filtered to a single user. Writes already carry an
 * explicit `user_id`, so the belt here is on SELECTs, where a forgotten filter
 * would otherwise leak another tenant's rows.
 *
 * Only tables keyed by a `user_id` column belong in USER_TABLES. Household tables
 * (chores, shopping_*, collection_schedules) are keyed by `household_id` and
 * self-scope through `fetchHomeData`, which gates on household membership
 * explicitly — adding them here would append a non-existent `user_id` filter and
 * break them. `profiles` is intentionally absent: callers query it by primary
 * key (`.eq("id", userId)`), which is already single-tenant.
 *
 * This scope is the same trust boundary the daily-plan cron has relied on since
 * Phase 4; Phase 14 (inbound replies) reuses it so a text/email reply executes
 * as exactly one user.
 */
const USER_TABLES = new Set([
  "tasks",
  "workouts",
  "workout_sets",
  "meals",
  "daily_plans",
  "google_tokens",
  "memories",
  "insights",
  "reminders",
  "fitness_integrations",
  "fitness_metrics",
  "fitness_events",
  "finance_accounts",
  "finance_transactions",
  "finance_goals",
  "finance_snapshots",
  "finance_reviews",
  // ai_conversations is scoped here because recordExchange selects the most
  // recent conversation WITHOUT a user filter (it trusts RLS). Under the service
  // client that would thread a reply into another user's history — so the scope
  // must supply the filter RLS otherwise would.
  "ai_conversations",
]);

export function scopedClient(base: SupabaseClient, userId: string): SupabaseClient {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          const builder = target.from(table);
          if (!USER_TABLES.has(table)) return builder;
          const originalSelect = builder.select.bind(builder);
          builder.select = ((...args: Parameters<typeof originalSelect>) =>
            originalSelect(...args).eq("user_id", userId)) as typeof builder.select;
          return builder;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as SupabaseClient;
}
