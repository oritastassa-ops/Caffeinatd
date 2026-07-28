import Link from "next/link";
import { after } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { getAccessToken } from "@/lib/google/oauth";
import { listEvents } from "@/lib/google/calendar";
import { endOfDayISO, localDateStr, startOfDayISO } from "@/lib/utils";
import { AIConversation, CalendarEvent, Capture, DailyPlan, Insight, Note, Reminder, Task } from "@/lib/types";
import { Card, CardTitle } from "@/components/ui";
import { QuickActions } from "@/components/quick-actions";
import { QuickCapture, CaptureInbox } from "@/components/quick-capture";
import { Timeline } from "@/components/timeline";
import { ReadinessCard } from "@/components/readiness-card";
import { InsightsCard } from "@/components/insights-card";
import { RemindersStrip } from "@/components/reminders-strip";
import { fetchWorkspaces } from "@/lib/workspaces/data";
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
import {
  buildTimeline,
  countOpenTasksByWorkspace,
  greetingFor,
  sumMacros,
} from "@/lib/dashboard/today";
import { MorningBrief } from "@/components/today/morning-brief";
import { PillarGlances } from "@/components/today/pillar-glances";
import { TodayFocus } from "@/components/today/today-focus";
import { TasksAndDeadlines } from "@/components/today/tasks-and-deadlines";
import { NutritionGlance } from "@/components/today/nutrition-glance";
import { QuickNotes } from "@/components/today/quick-notes";
import { RecentConversations } from "@/components/today/recent-conversations";
import { WorkspacesSection } from "@/components/today/workspaces-section";
import { CollectionsBanner } from "@/components/today/collections-banner";

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

  const in7days = new Date(Date.now() + 7 * 86400_000).toISOString();
  const [{ data: noteRows }, { data: captureRows }, { data: conversationRows }, { data: deadlineRows }, { data: wsTaskRows }, workspaces] =
    await Promise.all([
      supabase.from("notes").select("*").order("updated_at", { ascending: false }).limit(3),
      supabase
        .from("captures")
        .select("*")
        .eq("status", "inbox")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("ai_conversations")
        .select("id, title, updated_at, workspace_id, created_at, messages")
        .order("updated_at", { ascending: false })
        .limit(3),
      supabase
        .from("tasks")
        .select("*")
        .is("completed_at", null)
        .not("due_at", "is", null)
        .lte("due_at", in7days)
        .order("due_at")
        .limit(6),
      supabase.from("tasks").select("workspace_id").is("completed_at", null).not("workspace_id", "is", null),
      fetchWorkspaces(supabase, user.id),
    ]);

  const recentNotes = (noteRows ?? []) as Note[];
  const captures = (captureRows ?? []) as Capture[];
  const conversations = (conversationRows ?? []) as AIConversation[];
  const deadlines = (deadlineRows ?? []) as Task[];
  const openByWorkspace = countOpenTasksByWorkspace(
    (wsTaskRows ?? []) as { workspace_id: string | null }[],
  );

  const plan = planRow?.plan as DailyPlan | undefined;
  const timelineItems = buildTimeline(events, plan?.schedule, today, tz);
  const totals = sumMacros(meals ?? []);
  const goal = profile.settings.calorieGoal;
  const proteinGoal = profile.settings.proteinGoal;

  const hour = Number(new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit" }));
  const dayOfWeek = new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayOfWeek);
  const { greeting, emoji } = greetingFor(hour);

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

  const homeData = await fetchHomeData(supabase, user.id);
  const choresDueToday = homeData
    ? homeData.chores.filter((c) => isDueOn(c, today, homeData.completions)).length
    : null;
  const homeCollections = homeData ? collectionStatuses(homeData.collections, today) : [];

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
  const nowISO = new Date().toISOString();

  const briefStats = [
    { label: "Schedule", value: events.length ? `${events.length} event${events.length > 1 ? "s" : ""}` : "Clear" },
    { label: "Top focus", value: focusItems[0] ?? "Nothing yet" },
    { label: "Training", value: workoutRec.label },
    { label: "Sleep", value: plan?.bedtime ? plan.bedtime.split(" ")[0]! : "—" },
  ];

  const glances = [
    { href: "/fitness", title: "Fitness", headline: workoutRec.label, sub: program ? `${program.name} · next session` : "recommended" },
    {
      href: "/nutrition",
      title: "Nutrition",
      headline: `${totals.p}g${proteinGoal ? ` / ${proteinGoal}g` : ""}`,
      sub: "protein today",
      accent: Boolean(proteinGoal && totals.p >= proteinGoal),
    },
    {
      href: "/tasks",
      title: "Productivity",
      headline: `${importantCount || openTasks.length}`,
      sub: importantCount ? "important tasks" : "open tasks",
    },
    {
      href: "/fitness",
      title: "Recovery",
      headline: recoveryScore !== null ? `${recoveryScore}%` : "—",
      sub: recoveryScore !== null ? "avg readiness" : "no data yet",
      accent: recoveryScore !== null && recoveryScore >= 75,
    },
    {
      href: "/finance",
      title: "Finance",
      headline: financeHealth ? `${financeHealth.score}` : "—",
      sub: financeHealth ? "financial health" : "add accounts",
      accent: financeHealth !== null && financeHealth.score >= 75,
    },
    {
      href: "/home",
      title: "Home",
      headline: choresDueToday !== null ? `${choresDueToday}` : "—",
      sub: choresDueToday !== null ? "chores due today" : "set up household",
      accent: choresDueToday === 0,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <MorningBrief
        dateStr={dateStr}
        greeting={greeting}
        emoji={emoji}
        displayName={profile.display_name}
        personality={profile.settings.communicationStyle ?? "supportive"}
        overview={overview}
        stats={briefStats}
      />

      <RemindersStrip reminders={(reminderRows as Reminder[] | null) ?? []} tz={tz} />

      <div className="flex flex-col gap-2">
        <QuickCapture />
        <CaptureInbox captures={captures} />
      </div>

      <CollectionsBanner collections={homeCollections} />

      <PillarGlances glances={glances} />

      {/* Primary spine (the day's plan) prominent; intelligence + macros in a
          denser right rail. Linearizes top-to-bottom on mobile. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardTitle>Today&apos;s timeline</CardTitle>
            {!accessToken && timelineItems.length === 0 ? (
              <p className="text-sm text-text-dim">
                <Link href="/settings" className="text-accent hover:underline">
                  Connect Google Calendar
                </Link>{" "}
                to see your day here.
              </p>
            ) : (
              <Timeline items={timelineItems} tz={tz} />
            )}
          </Card>

          <TodayFocus items={focusItems} />
          <TasksAndDeadlines openTasks={openTasks} deadlines={deadlines} nowISO={nowISO} />
        </div>

        <div className="flex flex-col gap-4">
          <ReadinessCard score={readiness.score} reasons={readiness.reasons} />
          <InsightsCard insights={(insightRows as Insight[] | null) ?? []} />
          <NutritionGlance totals={totals} goal={goal} />
          <QuickNotes notes={recentNotes} />
        </div>
      </div>

      <Card>
        <CardTitle>Quick actions</CardTitle>
        <QuickActions />
      </Card>

      <WorkspacesSection workspaces={workspaces} openByWorkspace={openByWorkspace} />
      <RecentConversations conversations={conversations} />
    </div>
  );
}
