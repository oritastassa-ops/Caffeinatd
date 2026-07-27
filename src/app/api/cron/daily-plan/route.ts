import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";
import { generateDailyPlan } from "@/lib/planning/daily";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { ensureInsights } from "@/lib/insights/generate";
import { notifyNewInsights, notifyFinanceReview } from "@/lib/notifications/pillar-hooks";
import { materializeRecurringTransactions, writeSnapshot } from "@/lib/finance/data";
import { currentWeekStart, generateWeeklyReview } from "@/lib/finance/review";
import { Profile } from "@/lib/types";

/**
 * Vercel Cron (04:00 UTC) — generates every user's plan before their morning.
 * Uses the service-role client (RLS bypass) because there is no user session.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const provider = getProvider();

  const { data: profiles, error } = await supabase.from("profiles").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Record<string, string> = {};
  for (const row of profiles ?? []) {
    const profile: Profile = {
      id: row.id,
      display_name: row.display_name,
      timezone: row.timezone || "UTC",
      settings: row.settings ?? {},
      onboarded_at: row.onboarded_at ?? null,
    };
    try {
      // The service client scopes queries inside generateDailyPlan by RLS
      // normally; with service role we must scope explicitly per user.
      // generateDailyPlan and ensureInsights each sync-if-stale internally,
      // so the daily cron run (which is always well past any reasonable
      // staleness threshold) naturally forces a fresh sync once a day.
      const scoped = scopedClient(supabase, profile.id);
      // Finance housekeeping first so the plan/insights see today's reality:
      // materialize due recurring transactions, then snapshot net worth.
      await materializeRecurringTransactions(scoped, profile.id).catch(() => null);
      await writeSnapshot(scoped, profile.id).catch(() => null);
      const generated = await generateDailyPlan(scoped, provider, profile);
      // Deliver the plan off-app. The dedupeKey (user + plan date) is why a
      // re-run of the 04:00 cron can't double-send. Only reached on real
      // success — generateDailyPlan now throws on a failed upsert or unparseable
      // plan (docs/12 §A1/§A2) — and guarded so a notification failure never
      // fails plan generation.
      await enqueueNotification(scoped, {
        userId: profile.id,
        kind: "daily_plan",
        payload: { name: profile.display_name, plan: generated.plan },
        dedupeKey: `daily_plan:${profile.id}:${generated.plan.date}`,
      }).catch((err) => {
        console.error(`[notifications:email] daily_plan enqueue failed for ${profile.id}:`, err);
        return null;
      });
      const newInsights = await ensureInsights(scoped, profile);
      // Notify only on genuinely new insights (ensureInsights returns just the
      // rows it inserted); guarded so a notification failure never breaks the run.
      await notifyNewInsights(scoped, profile.id, newInsights);
      // Weekly review: generated once per week, on the first cron run of the
      // user's local week (upsert makes reruns harmless).
      const weekStart = currentWeekStart(profile.timezone);
      const { data: existingReview } = await scoped
        .from("finance_reviews")
        .select("week_start")
        .eq("week_start", weekStart)
        .maybeSingle();
      if (!existingReview) {
        const review = await generateWeeklyReview(scoped, provider, profile, weekStart).catch(() => null);
        if (review) await notifyFinanceReview(scoped, profile, weekStart, review);
      }
      results[profile.id] = "ok";
    } catch (err) {
      results[profile.id] = err instanceof Error ? err.message : "failed";
    }
  }
  return NextResponse.json({ results });
}

/**
 * Wraps the service client so every from() query is filtered to one user,
 * mirroring what RLS does for session clients. Only the tables the planner
 * reads/writes are user-scoped; the pass-through covers rpc etc.
 */
function scopedClient(base: ReturnType<typeof getServiceClient>, userId: string) {
  const USER_TABLES = new Set([
    "tasks",
    "workouts",
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
  ]);
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
  }) as ReturnType<typeof getServiceClient>;
}
