import Link from "next/link";
import { after } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { getAccessToken } from "@/lib/google/oauth";
import { listEvents } from "@/lib/google/calendar";
import { endOfDayISO, formatTime, localDateStr, startOfDayISO } from "@/lib/utils";
import { CalendarEvent, DailyPlan, Insight, Reminder, Task } from "@/lib/types";
import { Card, CardTitle, EmptyState, PriorityBadge } from "@/components/ui";
import { QuickActions } from "@/components/quick-actions";
import { ReadinessCard } from "@/components/readiness-card";
import { InsightsCard } from "@/components/insights-card";
import { RemindersStrip } from "@/components/reminders-strip";
import { ensureInsights } from "@/lib/insights/generate";
import { computeReadiness } from "@/lib/planning/readiness";
import { fetchSetRows } from "@/lib/fitness/refresh";
import { computeMuscleRecovery } from "@/lib/fitness/recovery";
import { getProgram, recommendProgramSession } from "@/lib/fitness/programs";
import { fetchFinanceData } from "@/lib/finance/data";
import { computeFinancialHealth } from "@/lib/finance/health";
import { forecastGoal } from "@/lib/finance/forecast";
import { fetchHomeData } from "@/lib/home/data";
import { isDueOn } from "@/lib/home/schedule";
import { collectionStatuses } from "@/lib/home/collections";
import { PixelAvatar } from "@/components/avatars/pixel-avatar";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const tz = profile.timezone;
  const today = localDateStr(tz);

  const accessToken = await getAccessToken(supabase, user.id);
  let events: CalendarEvent[] = [];
  if (accessToken) {
    try {
      events = await listEvents(accessToken, startOfDayISO(today, tz), endOfDayISO(today, tz), user.id);
    } catch {
      // calendar hiccup — the view degrades, it doesn't break
    }
  }

  // Deterministic, no AI call — but it re-reads several pillars (and may hit
  // the Hevy API via sync-if-stale), so it runs *after* the response is sent.
  // The page renders with today's stored insights; fresh ones appear next load.
  after(() => ensureInsights(supabase, profile).catch(() => null));

  const weekAgo = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);
  const [
    { data: planRow },
    { data: tasks },
    { data: meals },
    { data: workouts },
    { count: overdueCount },
    { data: insightRows },
    { data: reminderRows },
    setRows,
  ] = await Promise.all([
    supabase.from("daily_plans").select("plan").eq("plan_date", today).maybeSingle(),
    supabase
      .from("tasks")
      .select("*")
      .is("completed_at", null)
      .order("priority")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from("meals")
      .select("calories, protein_g, carbs_g, fat_g")
      .gte("eaten_at", startOfDayISO(today, tz))
      .lte("eaten_at", endOfDayISO(today, tz)),
    supabase
      .from("workouts")
      .select("performed_on, title")
      .gte("performed_on", weekAgo)
      .order("performed_on", { ascending: false }),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .is("completed_at", null)
      .lt("due_at", new Date().toISOString()),
    supabase
      .from("insights")
      .select("id, domain, message, reason, importance, created_at, acted_on, action_preset")
      .is("dismissed_at", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("reminders")
      .select("id, linked_table, linked_id, message, remind_at, notification_type, completed_at")
      .is("completed_at", null)
      .lte("remind_at", new Date(Date.now() + 2 * 3600_000).toISOString())
      .order("remind_at"),
    fetchSetRows(supabase, user.id),
  ]);

  const plan = planRow?.plan as DailyPlan | undefined;
  const totals = (meals ?? []).reduce(
    (acc, m) => ({
      kcal: acc.kcal + (m.calories ?? 0),
      p: acc.p + (m.protein_g ?? 0),
      c: acc.c + (m.carbs_g ?? 0),
      f: acc.f + (m.fat_g ?? 0),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
  const goal = profile.settings.calorieGoal;
  const proteinGoal = profile.settings.proteinGoal;

  const hour = Number(new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit" }));
  const dayOfWeek = new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayOfWeek);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greetingEmoji = hour < 12 ? "☀️" : hour < 18 ? "🌤️" : "🌙";

  const readiness = computeReadiness({
    overdueTaskCount: overdueCount ?? 0,
    weeklyWorkoutTarget: profile.settings.weeklyWorkoutTarget ?? 3,
    workoutsThisWeek: (workouts ?? []).length,
    dayOfWeek: dayIndex,
    proteinGoal,
    proteinLoggedToday: totals.p,
    mealsLoggedToday: (meals ?? []).length,
    hourOfDay: hour,
    todayEvents: events,
  });

  // ── Finance glance for the dashboard ────────────────────────────────────
  const financeData = await fetchFinanceData(supabase, user.id);
  const hasFinanceData = financeData.accounts.length > 0 || financeData.transactions.length > 0;
  const financeHealth = hasFinanceData
    ? computeFinancialHealth(
        financeData.accounts,
        financeData.transactions,
        financeData.goals.map((g) =>
          forecastGoal(g, financeData.accounts.find((a) => a.id === g.linked_account_id) ?? null),
        ),
      )
    : null;

  // ── Home glance for the dashboard ───────────────────────────────────────
  const homeData = await fetchHomeData(supabase, user.id);
  const choresDueToday = homeData
    ? homeData.chores.filter((c) => isDueOn(c, today, homeData.completions)).length
    : null;
  const homeCollections = homeData ? collectionStatuses(homeData.collections, today) : [];

  // ── Fitness intelligence for the dashboard ──────────────────────────────
  const recovery = computeMuscleRecovery(setRows);
  const recoveryScore = recovery.length
    ? Math.round(recovery.reduce((s, r) => s + r.percent, 0) / recovery.length)
    : null;
  const program = getProgram(profile.settings.trainingProgramId);
  const workoutRec = recommendProgramSession(program, workouts ?? [], recovery, today);

  const openTasks = (tasks as Task[] | null) ?? [];
  const importantCount = openTasks.filter((t) => t.priority <= 2).length;
  const focusItems = plan?.priorities.length ? plan.priorities : openTasks.slice(0, 3).map((t) => t.title);
  const overview = plan?.overview ?? "Here's your day at a glance. Ask me to plan it in detail anytime.";

  const dateStr = new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="flex flex-col gap-4">
      {/* ── Morning Brief ────────────────────────────────────────────────── */}
      <Card className="card-enter border-accent/25 bg-gradient-to-br from-accent-soft/60 to-surface">
        <p className="text-xs font-medium uppercase tracking-wider text-text-dim">{dateStr}</p>
        <div className="mt-1 flex items-center gap-3">
          <PixelAvatar
            personality={profile.settings.communicationStyle ?? "supportive"}
            size={40}
            mode="idle"
          />
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}, {profile.display_name} {greetingEmoji}
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-dim">{overview}</p>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <BriefStat label="Schedule" value={events.length ? `${events.length} event${events.length > 1 ? "s" : ""}` : "Clear"} />
          <BriefStat label="Top focus" value={focusItems[0] ?? "Nothing yet"} />
          <BriefStat label="Training" value={workoutRec.label} />
          <BriefStat label="Sleep" value={plan?.bedtime ? plan.bedtime.split(" ")[0]! : "—"} />
        </div>
      </Card>

      <RemindersStrip reminders={(reminderRows as Reminder[] | null) ?? []} tz={tz} />

      {/* Collections due tonight/today ride the top of the dashboard */}
      {homeCollections.length > 0 && (
        <div className="flex flex-col gap-2">
          {homeCollections.map((s) => (
            <Link
              key={s.type}
              href="/home"
              className="card-enter flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm hover:border-accent"
            >
              <span aria-hidden>🗑</span>
              <span className="flex-1 font-medium">{s.label}</span>
              <span className="tabular text-xs text-text-dim">{s.date.slice(5)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* ── Glanceable insight cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <GlanceCard
          href="/fitness"
          title="Fitness"
          headline={workoutRec.label}
          sub={program ? `${program.name} · next session` : "recommended"}
        />
        <GlanceCard
          href="/nutrition"
          title="Nutrition"
          headline={`${totals.p}g${proteinGoal ? ` / ${proteinGoal}g` : ""}`}
          sub="protein today"
          accent={Boolean(proteinGoal && totals.p >= proteinGoal)}
        />
        <GlanceCard
          href="/tasks"
          title="Productivity"
          headline={`${importantCount || openTasks.length}`}
          sub={importantCount ? "important tasks" : "open tasks"}
        />
        <GlanceCard
          href="/fitness"
          title="Recovery"
          headline={recoveryScore !== null ? `${recoveryScore}%` : "—"}
          sub={recoveryScore !== null ? "avg readiness" : "no data yet"}
          accent={recoveryScore !== null && recoveryScore >= 75}
        />
        <GlanceCard
          href="/finance"
          title="Finance"
          headline={financeHealth ? `${financeHealth.score}` : "—"}
          sub={financeHealth ? "financial health" : "add accounts"}
          accent={financeHealth !== null && financeHealth.score >= 75}
        />
        <GlanceCard
          href="/home"
          title="Home"
          headline={choresDueToday !== null ? `${choresDueToday}` : "—"}
          sub={choresDueToday !== null ? "chores due today" : "set up household"}
          accent={choresDueToday === 0}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ReadinessCard score={readiness.score} reasons={readiness.reasons} />

        <Card>
          <CardTitle>Today&apos;s focus</CardTitle>
          {focusItems.length === 0 ? (
            <EmptyState title="A fresh cup, a fresh start ☕" hint="Nothing prioritized yet — ask me to plan your day." />
          ) : (
            <ol className="flex flex-col gap-2">
              {focusItems.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="font-semibold text-accent">{i + 1}.</span>
                  <Link href="/tasks" className="hover:underline">
                    {item}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <InsightsCard insights={(insightRows as Insight[] | null) ?? []} />

      <Card>
        <CardTitle>Quick actions</CardTitle>
        <QuickActions />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Agenda</CardTitle>
          {!accessToken ? (
            <p className="text-sm text-text-dim">
              <Link href="/settings" className="text-accent hover:underline">
                Connect Google Calendar
              </Link>{" "}
              to see your day here.
            </p>
          ) : events.length === 0 ? (
            <p className="text-sm text-text-dim">Nothing on the calendar today.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {events.map((e) => (
                <li key={`${e.calendarId}:${e.id}`} className="flex gap-3 text-sm">
                  <span className="tabular w-24 shrink-0 text-text-dim">
                    {e.allDay ? "All day" : formatTime(e.start, tz)}
                  </span>
                  <span>
                    {e.summary}
                    {!e.isPrimary && <span className="text-text-dim"> · {e.calendarSummary}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Open tasks</CardTitle>
          {openTasks.length === 0 ? (
            <p className="text-sm text-text-dim">All clear. Ask me to add something.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {openTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <PriorityBadge priority={t.priority} />
                  <span className="truncate">{t.title}</span>
                  {t.due_at && (
                    <span className="ml-auto shrink-0 text-xs text-text-dim">{t.due_at.slice(5, 10)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Nutrition today</CardTitle>
        <div className="tabular flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Macro label="Calories" value={`${totals.kcal}${goal ? ` / ${goal}` : ""}`} />
          <Macro label="Protein" value={`${totals.p}g`} />
          <Macro label="Carbs" value={`${totals.c}g`} />
          <Macro label="Fat" value={`${totals.f}g`} />
        </div>
      </Card>
    </div>
  );
}

function BriefStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

function GlanceCard({
  href,
  title,
  headline,
  sub,
  accent,
}: {
  href: string;
  title: string;
  headline: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="transition-fast group rounded-xl border bg-surface p-4 hover:border-accent"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{title}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${accent ? "text-good" : ""}`} title={headline}>
        {headline}
      </p>
      <p className="text-xs text-text-dim">{sub}</p>
    </Link>
  );
}

function Macro({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{label}</p>
      <p className="mt-0.5 text-lg font-medium">{value}</p>
    </div>
  );
}
