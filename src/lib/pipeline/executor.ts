import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AIProvider, ToolCall } from "@/lib/ai/types";
import { ActionReceipt, MemoryKind, Profile } from "@/lib/types";
import { toolSchemas, ToolName } from "./tools";
import { saveMemory } from "@/lib/memory";
import { getAccessToken } from "@/lib/google/oauth";
import {
  createEvent,
  decodeEventKey,
  deleteEvent,
  encodeEventKey,
  findConflicts,
  getBusy,
  listEvents,
  updateEvent,
} from "@/lib/google/calendar";
import { generateDailyPlan } from "@/lib/planning/daily";
import { recommendSleep } from "@/lib/planning/sleep";
import { buildFitnessReport } from "@/lib/fitness/report";
import { recomputeFitnessMetrics } from "@/lib/fitness/refresh";
import { buildFinanceReport } from "@/lib/finance/report";
import { fetchFinanceData } from "@/lib/finance/data";
import { computeNetWorth } from "@/lib/finance/networth";
import { simulate } from "@/lib/finance/simulate";
import { money } from "@/lib/finance/format";
import { fetchHomeData, resolveMember } from "@/lib/home/data";
import { isDueOn, nextAssignee, overdueDays } from "@/lib/home/schedule";
import { buildHomeReport } from "@/lib/home/report";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import {
  endOfDayISO,
  formatDay,
  formatTime,
  localDateStr,
  startOfDayISO,
  zonedTimeToUtc,
} from "@/lib/utils";

export interface ExecContext {
  supabase: SupabaseClient;
  provider: AIProvider;
  profile: Profile;
}

export interface ExecOutcome {
  /** Fed back to the model as the tool result. */
  result: string;
  /** Rendered in the UI as an undoable chip, when the tool mutated state. */
  receipt?: ActionReceipt;
  /**
   * A user-ready reply. When a tool that fully answers the request (e.g.
   * generate_daily_plan) sets this, the pipeline returns it directly instead
   * of spending another model round-trip re-phrasing the tool result — one
   * fewer call to fail or time out.
   */
  finalText?: string;
}

/**
 * Validates LLM-supplied arguments with the same Zod schema that produced the
 * tool contract, then dispatches. Validation errors go back to the model as
 * tool errors so it can self-correct within the hop budget.
 */
export async function executeToolCall(ctx: ExecContext, call: ToolCall): Promise<ExecOutcome> {
  const schema = toolSchemas[call.name as ToolName];
  if (!schema) return { result: `Error: unknown tool "${call.name}"` };

  const parsed = schema.safeParse(call.arguments);
  if (!parsed.success) {
    return { result: `Error: invalid arguments — ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }

  try {
    return await handlers[call.name as ToolName](ctx, parsed.data as never);
  } catch (err) {
    return { result: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

type Handler<N extends ToolName> = (
  ctx: ExecContext,
  args: z.infer<(typeof toolSchemas)[N]>,
) => Promise<ExecOutcome>;

async function calendarToken(ctx: ExecContext): Promise<string> {
  const token = await getAccessToken(ctx.supabase, ctx.profile.id);
  if (!token) throw new Error("Google Calendar is not connected (Settings → Connect calendar).");
  return token;
}

const handlers: { [N in ToolName]: Handler<N> } = {
  async create_task(ctx, args) {
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.profile.id,
        title: args.title,
        notes: args.notes ?? null,
        priority: args.priority ?? 3,
        category: args.category ?? null,
        project: args.project ?? null,
        due_at: args.due_at ?? null,
        recurrence: args.recurrence ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const due = args.due_at ? ` — due ${formatDay(args.due_at, ctx.profile.timezone)}` : "";
    return {
      result: `Task created: "${args.title}"${due}`,
      receipt: {
        tool: "create_task",
        label: `Task created: ${args.title}${due}`,
        undo: { table: "tasks", id: data.id },
      },
    };
  },

  async complete_task(ctx, args) {
    const { data } = await ctx.supabase
      .from("tasks")
      .select("id, title")
      .is("completed_at", null)
      .ilike("title", `%${args.title_query}%`)
      .limit(2);
    if (!data?.length) return { result: `No open task matching "${args.title_query}" found.` };
    if (data.length > 1) {
      return { result: `Ambiguous — matches: ${data.map((t) => t.title).join(" / ")}. Ask which one.` };
    }
    const task = data[0]!;
    const { error } = await ctx.supabase
      .from("tasks")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) throw new Error(error.message);
    return {
      result: `Completed "${task.title}".`,
      receipt: { tool: "complete_task", label: `Completed: ${task.title}` },
    };
  },

  async list_tasks(ctx, args) {
    let q = ctx.supabase
      .from("tasks")
      .select("title, priority, due_at, category, completed_at")
      .order("priority")
      .limit(25);
    if (!args.include_completed) q = q.is("completed_at", null);
    const { data } = await q;
    if (!data?.length) return { result: "No tasks." };
    return {
      result: data
        .map(
          (t) =>
            `[P${t.priority}] ${t.title}${t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : ""}${t.completed_at ? " ✓" : ""}`,
        )
        .join("\n"),
    };
  },

  async log_workout(ctx, args) {
    const { data, error } = await ctx.supabase
      .from("workouts")
      .insert({
        user_id: ctx.profile.id,
        title: args.title,
        kind: args.kind,
        performed_on: args.performed_on ?? localDateStr(ctx.profile.timezone),
        duration_min: args.duration_min ?? null,
        distance_km: args.distance_km ?? null,
        notes: args.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (args.sets?.length) {
      const rows = args.sets.map((s, i) => ({
        workout_id: data.id,
        user_id: ctx.profile.id,
        exercise: s.exercise,
        set_no: s.set_no ?? i + 1,
        reps: s.reps ?? null,
        weight_kg: s.weight_kg ?? null,
      }));
      const { error: setErr } = await ctx.supabase.from("workout_sets").insert(rows);
      if (setErr) throw new Error(setErr.message);
    }
    // Fitness intelligence (1RM, recovery, consistency) reads from this cache
    // regardless of whether the workout came from Hevy or manual logging.
    await recomputeFitnessMetrics(ctx.supabase, ctx.profile.id);
    const detail = args.sets?.length ? ` (${args.sets.length} sets)` : "";
    return {
      result: `Workout logged: ${args.title}${detail}`,
      receipt: {
        tool: "log_workout",
        label: `Workout logged: ${args.title}${detail}`,
        undo: { table: "workouts", id: data.id }, // sets cascade
      },
    };
  },

  async log_meal(ctx, args) {
    const { data, error } = await ctx.supabase
      .from("meals")
      .insert({
        user_id: ctx.profile.id,
        description: args.description,
        meal_type: args.meal_type ?? null,
        calories: args.calories,
        protein_g: args.protein_g,
        carbs_g: args.carbs_g,
        fat_g: args.fat_g,
        eaten_at: args.eaten_at ?? new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const macros = `~${args.calories} kcal · ${args.protein_g}P ${args.carbs_g}C ${args.fat_g}F`;
    return {
      result: `Meal logged: ${args.description} (${macros})`,
      receipt: {
        tool: "log_meal",
        label: `Logged: ${args.description} — ${macros}`,
        undo: { table: "meals", id: data.id },
      },
    };
  },

  async get_agenda(ctx, args) {
    const tz = ctx.profile.timezone;
    const date = args.date ?? localDateStr(tz);
    const days = args.days ?? 1;
    const token = await calendarToken(ctx);
    const endDate = localDateStr(
      tz,
      new Date(new Date(startOfDayISO(date, tz)).getTime() + (days - 1) * 86400_000 + 12 * 3600_000),
    );
    const events = await listEvents(
      token,
      startOfDayISO(date, tz),
      endOfDayISO(endDate, tz),
      ctx.profile.id,
    );
    if (!events.length) return { result: `No events between ${date} and ${endDate}.` };
    return {
      result: events
        .map((e) => {
          const calTag = !e.isPrimary ? ` (${e.calendarSummary})` : "";
          const key = encodeEventKey(e.calendarId, e.id);
          return e.allDay
            ? `${e.start} (all day) ${e.summary}${calTag} [id:${key}]`
            : `${formatDay(e.start, tz)} ${formatTime(e.start, tz)}–${formatTime(e.end, tz)} ${e.summary}${e.location ? ` @ ${e.location}` : ""}${calTag} [id:${key}]`;
        })
        .join("\n"),
    };
  },

  async create_event(ctx, args) {
    const tz = ctx.profile.timezone;
    const token = await calendarToken(ctx);
    const startISO = zonedTimeToUtc(args.date, args.start_time, tz).toISOString();
    const endISO = zonedTimeToUtc(args.date, args.end_time, tz).toISOString();

    const busy = await getBusy(token, startOfDayISO(args.date, tz), endOfDayISO(args.date, tz));
    const conflicts = findConflicts(busy, startISO, endISO);
    if (conflicts.length) {
      return {
        result:
          `CONFLICT — the slot overlaps: ` +
          conflicts.map((c) => `${formatTime(c.start, tz)}–${formatTime(c.end, tz)}`).join(", ") +
          `. Do not book. Report the conflict and propose free alternatives (busy that day: ` +
          busy.map((b) => `${formatTime(b.start, tz)}–${formatTime(b.end, tz)}`).join(", ") +
          `).`,
      };
    }

    const event = await createEvent(token, {
      summary: args.summary,
      startISO,
      endISO,
      location: args.location,
      description: args.description,
      recurrence: args.recurrence,
    });
    const label = `Event created: ${args.summary} — ${formatDay(startISO, tz)} ${formatTime(startISO, tz)}`;
    return {
      result: label,
      receipt: {
        tool: "create_event",
        label,
        undo: { calendarId: "primary", calendarEventId: event.id },
      },
    };
  },

  async update_event(ctx, args) {
    const tz = ctx.profile.timezone;
    const token = await calendarToken(ctx);
    const { calendarId, eventId } = decodeEventKey(args.event_id);
    const patch: Parameters<typeof updateEvent>[3] = { summary: args.summary, location: args.location };
    if (args.date && args.start_time) patch.startISO = zonedTimeToUtc(args.date, args.start_time, tz).toISOString();
    if (args.date && args.end_time) patch.endISO = zonedTimeToUtc(args.date, args.end_time, tz).toISOString();
    const event = await updateEvent(token, calendarId, eventId, patch);
    return {
      result: `Event updated: ${event.summary} — ${formatDay(event.start, tz)} ${formatTime(event.start, tz)}`,
      receipt: { tool: "update_event", label: `Event updated: ${event.summary}` },
    };
  },

  async delete_event(ctx, args) {
    const token = await calendarToken(ctx);
    const { calendarId, eventId } = decodeEventKey(args.event_id);
    await deleteEvent(token, calendarId, eventId);
    return {
      result: "Event deleted.",
      receipt: { tool: "delete_event", label: "Event deleted" },
    };
  },

  async save_memory(ctx, args) {
    const { id, deduped } = await saveMemory(
      ctx.supabase,
      ctx.provider,
      ctx.profile.id,
      args.kind as MemoryKind,
      args.content,
      args.importance ?? 3,
    );
    if (deduped) {
      return { result: `Already knew that (${args.kind}): ${args.content}` };
    }
    return {
      result: `Remembered (${args.kind}): ${args.content}`,
      receipt: {
        tool: "save_memory",
        label: `Remembered: ${args.content}`,
        undo: { table: "memories", id },
      },
    };
  },

  // No DB write here — this only asks the user. api/assistant/confirm-memory
  // does the actual saveMemory() call if they click Remember.
  async suggest_memory(ctx, args) {
    return {
      result: `Asked the user to confirm: (${args.kind}) ${args.content}`,
      receipt: {
        tool: "suggest_memory",
        label: `I noticed: ${args.content}`,
        confirm: { kind: args.kind as MemoryKind, content: args.content, importance: args.importance ?? 3 },
      },
    };
  },

  async create_reminder(ctx, args) {
    const { data, error } = await ctx.supabase
      .from("reminders")
      .insert({
        user_id: ctx.profile.id,
        message: args.message,
        remind_at: args.remind_at,
        linked_table: args.linked_table ?? null,
        linked_id: args.linked_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const when = formatDay(args.remind_at, ctx.profile.timezone) + " " + formatTime(args.remind_at, ctx.profile.timezone);
    return {
      result: `Reminder set for ${when}: ${args.message}`,
      receipt: {
        tool: "create_reminder",
        label: `Reminder set: ${args.message} — ${when}`,
        undo: { table: "reminders", id: data.id },
      },
    };
  },

  async schedule_reminder(ctx, args) {
    const tz = ctx.profile.timezone;
    const channel = args.channel ?? "auto";
    const { data, error } = await ctx.supabase
      .from("reminders")
      .insert({
        user_id: ctx.profile.id,
        message: args.message,
        remind_at: args.remind_at,
        notification_type: channel, // 'auto' delegates to preferences; else forces the channel
        urgent: args.urgent ?? false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const when = `${formatDay(args.remind_at, tz)} ${formatTime(args.remind_at, tz)}`;
    const via = channel === "auto" ? "your usual channels" : channel === "in_app" ? "in-app" : channel;
    return {
      result: `Reminder set for ${when} (${via}): ${args.message}`,
      receipt: {
        tool: "schedule_reminder",
        label: `Reminder: ${args.message} — ${when}${channel === "auto" ? "" : ` (${via})`}`,
        undo: { table: "reminders", id: data.id },
      },
    };
  },

  async cancel_reminder(ctx, args) {
    const { data } = await ctx.supabase
      .from("reminders")
      .select("id, message")
      .is("completed_at", null)
      .ilike("message", `%${args.query}%`)
      .limit(2);
    if (!data?.length) return { result: `No pending reminder matching "${args.query}".` };
    if (data.length > 1) {
      return { result: `Ambiguous — matches: ${data.map((r) => r.message).join(" / ")}. Ask which one.` };
    }
    const reminder = data[0]!;
    const { error } = await ctx.supabase
      .from("reminders")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", reminder.id);
    if (error) throw new Error(error.message);
    // Stop any queued-but-unsent delivery for it (dedupe_key scopes to this reminder).
    const { error: delErr } = await ctx.supabase
      .from("notification_deliveries")
      .update({ status: "skipped", last_error: "reminder canceled" })
      .eq("dedupe_key", `reminder:${reminder.id}`)
      .eq("status", "pending");
    if (delErr) throw new Error(delErr.message);
    return {
      result: `Canceled reminder: ${reminder.message}`,
      receipt: { tool: "cancel_reminder", label: `Reminder canceled: ${reminder.message}` },
    };
  },

  async list_reminders(ctx, args) {
    const tz = ctx.profile.timezone;
    let q = ctx.supabase
      .from("reminders")
      .select("message, remind_at, notification_type, completed_at")
      .order("remind_at")
      .limit(25);
    if (!args.include_completed) q = q.is("completed_at", null);
    const { data } = await q;
    if (!data?.length) return { result: "No reminders." };
    return {
      result: data
        .map(
          (r) =>
            `${formatDay(r.remind_at, tz)} ${formatTime(r.remind_at, tz)} — ${r.message}${r.completed_at ? " ✓" : ""}`,
        )
        .join("\n"),
    };
  },

  async notify_me(ctx, args) {
    const tz = ctx.profile.timezone;
    // Per-conversation abuse guard: cap direct one-off messages in a short window
    // (kind 'system' is only produced by this tool).
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await ctx.supabase
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.profile.id)
      .eq("kind", "system")
      .gte("created_at", tenMinAgo);
    if ((count ?? 0) >= 3) {
      return { result: "I've already sent you a few messages in the last few minutes — I'll hold off so I'm not spamming you." };
    }

    const channel = args.channel && args.channel !== "auto" ? args.channel : undefined;
    const res = await enqueueNotification(ctx.supabase, {
      userId: ctx.profile.id,
      kind: "system",
      payload: { message: args.message },
      scheduledFor: args.at ? new Date(args.at) : new Date(),
      channelOverride: channel,
      dedupeKey: `notify:${ctx.profile.id}:${Date.now()}`,
    });
    if (res.queued === 0) {
      return {
        result: `Error: couldn't send that — ${res.skipped.join("; ") || "no verified contact to reach you on"}. Ask the user to verify a contact in Settings.`,
      };
    }
    const whenPhrase = args.at ? `at ${formatDay(args.at, tz)} ${formatTime(args.at, tz)}` : "shortly";
    return {
      result: `I'll send you ${whenPhrase}: "${args.message}"`,
      receipt: { tool: "notify_me", label: `Message queued ${whenPhrase}: ${args.message}` },
    };
  },

  async recommend_bedtime(ctx) {
    const tz = ctx.profile.timezone;
    const tomorrow = localDateStr(tz, new Date(Date.now() + 86400_000));
    let first: { time: string; summary: string } | null = null;
    const token = await getAccessToken(ctx.supabase, ctx.profile.id);
    if (token) {
      const events = await listEvents(
        token,
        startOfDayISO(tomorrow, tz),
        endOfDayISO(tomorrow, tz),
        ctx.profile.id,
      );
      const e = events.find((ev) => !ev.allDay);
      if (e) {
        first = {
          time: new Date(e.start).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }),
          summary: e.summary,
        };
      }
    }
    const rec = recommendSleep(first, ctx.profile.settings);
    return {
      result: `Bedtime ${rec.bedtime}, wind down from ${rec.windDownStart}, wake ${rec.wake}. (${rec.rationale})`,
    };
  },

  async generate_daily_plan(ctx, args) {
    const { plan, createdEvents, createdTasks, calendarConnected } = await generateDailyPlan(
      ctx.supabase,
      ctx.provider,
      ctx.profile,
      args.date,
      true, // explicit "plan my day" materializes: calendar events + tasks
    );
    const outcomes = [
      calendarConnected
        ? createdEvents.length
          ? `Added to Google Calendar: ${createdEvents.join("; ")}.`
          : "No new calendar events (day already scheduled or no free blocks)."
        : "Google Calendar is NOT connected, so no events were created — tell the user to connect it in Settings.",
      createdTasks.length ? `New tasks created: ${createdTasks.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const counts = [
      createdEvents.length && `${createdEvents.length} event${createdEvents.length > 1 ? "s" : ""} scheduled`,
      createdTasks.length && `${createdTasks.length} task${createdTasks.length > 1 ? "s" : ""} added`,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      result: `Plan generated for ${plan.date}: ${plan.overview} Priorities: ${plan.priorities.join("; ")} ${outcomes}`,
      receipt: {
        tool: "generate_daily_plan",
        label: `Daily plan for ${plan.date}${counts ? ` — ${counts}` : ""}`,
      },
      // The plan already IS the answer — no need for another model call to
      // re-phrase it (that extra hop was the flakiest link in "plan my day").
      finalText: [
        plan.overview,
        plan.priorities.length ? `Today's priorities: ${plan.priorities.join("; ")}.` : "",
        outcomes,
        `Suggested bedtime: ${plan.bedtime.split(" — ")[0]}.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  },

  async get_fitness_report(ctx, args) {
    const report = await buildFitnessReport(ctx.supabase, ctx.profile, args.exercise);
    return { result: report };
  },

  async log_expense(ctx, args) {
    const { data, error } = await ctx.supabase
      .from("finance_transactions")
      .insert({
        user_id: ctx.profile.id,
        direction: "expense",
        amount: args.amount,
        category: args.category,
        description: args.description,
        occurred_on: args.occurred_on ?? localDateStr(ctx.profile.timezone),
        recurrence: args.recurrence ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const label = `Expense logged: ${args.description} — ${money(args.amount)} (${args.category})${args.recurrence ? ", recurring" : ""}`;
    return {
      result: label,
      receipt: { tool: "log_expense", label, undo: { table: "finance_transactions", id: data.id } },
    };
  },

  async log_income(ctx, args) {
    const { data, error } = await ctx.supabase
      .from("finance_transactions")
      .insert({
        user_id: ctx.profile.id,
        direction: "income",
        amount: args.amount,
        category: args.category,
        description: args.description,
        occurred_on: args.occurred_on ?? localDateStr(ctx.profile.timezone),
        recurrence: args.recurrence ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const label = `Income logged: ${args.description} — ${money(args.amount)}${args.recurrence ? ", recurring" : ""}`;
    return {
      result: label,
      receipt: { tool: "log_income", label, undo: { table: "finance_transactions", id: data.id } },
    };
  },

  async create_finance_goal(ctx, args) {
    const { data, error } = await ctx.supabase
      .from("finance_goals")
      .insert({
        user_id: ctx.profile.id,
        title: args.title,
        target_amount: args.target_amount,
        current_amount: args.current_amount ?? 0,
        monthly_contribution: args.monthly_contribution ?? 0,
        deadline: args.deadline ?? null,
        priority: args.priority ?? 3,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const label = `Goal created: ${args.title} — ${money(args.target_amount)} target`;
    return {
      result: label,
      receipt: { tool: "create_finance_goal", label, undo: { table: "finance_goals", id: data.id } },
    };
  },

  async get_finance_report(ctx) {
    return { result: await buildFinanceReport(ctx.supabase, ctx.profile.id) };
  },

  async simulate_finances(ctx, args) {
    const data = await fetchFinanceData(ctx.supabase, ctx.profile.id);
    const nw = computeNetWorth(data.accounts, data.snapshots);
    const result = simulate(
      { accounts: data.accounts, transactions: data.transactions, goals: data.goals, cashAvailable: nw.cashAvailable },
      {
        extraMonthlySavings: args.extra_monthly_savings,
        incomeChange: args.income_change,
        expenseChange: args.expense_change,
        oneTimePurchase: args.one_time_purchase,
      },
    );
    const goalLine = (side: typeof result.before) =>
      side.goals.map((g) => `${g.title}: ${g.estimatedCompletion ?? "no ETA"}`).join(", ") || "no goals";
    return {
      result:
        `BEFORE — monthly net ${money(result.before.monthlyNet)}, cash in 12mo ${money(result.before.cashIn12Months)}, ` +
        `health ${result.before.healthScore}/100, goals: ${goalLine(result.before)}.\n` +
        `AFTER — monthly net ${money(result.after.monthlyNet)}, cash in 12mo ${money(result.after.cashIn12Months)}, ` +
        `health ${result.after.healthScore}/100, goals: ${goalLine(result.after)}.\n` +
        `Explain the trade-offs these numbers show; do not recompute them.`,
    };
  },

  /* ── Home ─────────────────────────────────────────────────────────────── */

  async add_chore(ctx, args) {
    const home = await fetchHomeData(ctx.supabase, ctx.profile.id);
    if (!home) return { result: NO_HOUSEHOLD };

    let assignedMemberId: string | null = null;
    if (args.assigned_to_name) {
      const match = resolveMember(home.members, args.assigned_to_name);
      if (match === "ambiguous") {
        return { result: `Several members match "${args.assigned_to_name}" — ask which one.` };
      }
      if (!match) {
        return {
          result: `No household member named "${args.assigned_to_name}". Members: ${home.members.map((m) => m.name).join(", ")}. Ask whether to add them first.`,
        };
      }
      assignedMemberId = match.id;
    }

    const { data, error } = await ctx.supabase
      .from("chores")
      .insert({
        household_id: home.household.id,
        title: args.title,
        cadence: args.cadence,
        category: args.category,
        assigned_member_id: assignedMemberId,
        rotate_assignment: args.rotate ?? false,
        anchor_date: args.due_date ?? localDateStr(ctx.profile.timezone),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const who = args.assigned_to_name ? ` → ${args.assigned_to_name}` : args.rotate ? " (rotating)" : "";
    const label = `Chore added: ${args.title} (${args.cadence.replace("_", "-")})${who}`;
    return { result: label, receipt: { tool: "add_chore", label, undo: { table: "chores", id: data.id } } };
  },

  async complete_chore(ctx, args) {
    const home = await fetchHomeData(ctx.supabase, ctx.profile.id);
    if (!home) return { result: NO_HOUSEHOLD };

    const matches = home.chores.filter((c) => c.title.toLowerCase().includes(args.title_query.toLowerCase()));
    if (matches.length === 0) return { result: `No chore matching "${args.title_query}".` };
    if (matches.length > 1) {
      return { result: `Ambiguous — matches: ${matches.map((c) => c.title).join(" / ")}. Ask which one.` };
    }
    const choreRow = matches[0]!;

    let memberId = home.me?.id ?? null;
    if (args.completed_by_name) {
      const match = resolveMember(home.members, args.completed_by_name);
      if (match === "ambiguous") return { result: `Several members match "${args.completed_by_name}" — ask which.` };
      if (!match) return { result: `No member named "${args.completed_by_name}".` };
      memberId = match.id;
    }

    const { data, error } = await ctx.supabase
      .from("chore_completions")
      .insert({
        chore_id: choreRow.id,
        household_id: home.household.id,
        member_id: memberId,
        completed_on: localDateStr(ctx.profile.timezone),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const label = `Completed: ${choreRow.title}`;
    return { result: label, receipt: { tool: "complete_chore", label, undo: { table: "chore_completions", id: data.id } } };
  },

  async list_chores(ctx, args) {
    const home = await fetchHomeData(ctx.supabase, ctx.profile.id);
    if (!home) return { result: NO_HOUSEHOLD };
    const today = localDateStr(ctx.profile.timezone);
    const filter = args.filter ?? "today";

    const rows = home.chores
      .map((c) => ({
        chore: c,
        due: isDueOn(c, today, home.completions),
        od: overdueDays(c, today, home.completions),
        who: nextAssignee(c, home.members, home.completions),
      }))
      .filter((r) => (filter === "all" ? true : filter === "overdue" ? r.od > 0 : r.due));
    if (rows.length === 0) return { result: filter === "all" ? "No chores set up." : `No ${filter} chores.` };
    return {
      result: rows
        .map(
          (r) =>
            `${r.chore.title} (${r.chore.cadence.replace("_", "-")}${r.who ? `, ${r.who.name}` : ""}${r.od > 0 ? `, ${r.od}d overdue` : r.due ? ", due today" : ""})`,
        )
        .join("\n"),
    };
  },

  async add_shopping_item(ctx, args) {
    const home = await fetchHomeData(ctx.supabase, ctx.profile.id);
    if (!home) return { result: NO_HOUSEHOLD };
    const list = resolveList(home.lists, args.list_name);
    if (!list) return { result: `No shopping list matching "${args.list_name}". Lists: ${home.lists.map((l) => l.name).join(", ")}.` };

    const { data, error } = await ctx.supabase
      .from("shopping_items")
      .insert({
        list_id: list.id,
        household_id: home.household.id,
        name: args.item,
        quantity: args.quantity ?? null,
        category: args.category,
        added_by_member_id: home.me?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const label = `Added to ${list.name}: ${args.item}${args.quantity ? ` (${args.quantity})` : ""}`;
    return { result: label, receipt: { tool: "add_shopping_item", label, undo: { table: "shopping_items", id: data.id } } };
  },

  async check_off_shopping(ctx, args) {
    const home = await fetchHomeData(ctx.supabase, ctx.profile.id);
    if (!home) return { result: NO_HOUSEHOLD };
    const list = resolveList(home.lists, args.list_name);
    if (!list) return { result: `No shopping list matching "${args.list_name}".` };

    const open = home.items.filter((i) => i.list_id === list.id && !i.completed_at);
    const targets = args.item_query
      ? open.filter((i) => i.name.toLowerCase().includes(args.item_query!.toLowerCase()))
      : open;
    if (targets.length === 0) {
      return { result: args.item_query ? `Nothing open matching "${args.item_query}" on ${list.name}.` : `${list.name} has no open items.` };
    }
    const { error } = await ctx.supabase
      .from("shopping_items")
      .update({ completed_at: new Date().toISOString() })
      .in("id", targets.map((t) => t.id));
    if (error) throw new Error(error.message);
    const label = args.item_query
      ? `Checked off: ${targets.map((t) => t.name).join(", ")}`
      : `Checked off all ${targets.length} items on ${list.name}`;
    return { result: label, receipt: { tool: "check_off_shopping", label } };
  },

  async remove_shopping_item(ctx, args) {
    const home = await fetchHomeData(ctx.supabase, ctx.profile.id);
    if (!home) return { result: NO_HOUSEHOLD };
    const list = resolveList(home.lists, args.list_name);
    if (!list) return { result: `No shopping list matching "${args.list_name}".` };
    const matches = home.items.filter(
      (i) => i.list_id === list.id && !i.completed_at && i.name.toLowerCase().includes(args.item_query.toLowerCase()),
    );
    if (matches.length === 0) return { result: `Nothing matching "${args.item_query}" on ${list.name}.` };
    const { error } = await ctx.supabase.from("shopping_items").delete().in("id", matches.map((m) => m.id));
    if (error) throw new Error(error.message);
    const label = `Removed from ${list.name}: ${matches.map((m) => m.name).join(", ")}`;
    return { result: label, receipt: { tool: "remove_shopping_item", label } };
  },

  async set_collection_schedule(ctx, args) {
    const home = await fetchHomeData(ctx.supabase, ctx.profile.id);
    if (!home) return { result: NO_HOUSEHOLD };
    const { data, error } = await ctx.supabase
      .from("collection_schedules")
      .upsert(
        {
          household_id: home.household.id,
          type: args.type,
          day_of_week: args.day_of_week,
          frequency: args.frequency ?? "weekly",
          anchor_date: localDateStr(ctx.profile.timezone),
        },
        { onConflict: "household_id,type" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const label = `${args.type.replace("_", " ")} pickup set: ${args.frequency ?? "weekly"} on ${days[args.day_of_week]}`;
    return {
      result: label,
      receipt: { tool: "set_collection_schedule", label, undo: { table: "collection_schedules", id: data.id } },
    };
  },

  async get_home_report(ctx) {
    return { result: await buildHomeReport(ctx.supabase, ctx.profile.id, localDateStr(ctx.profile.timezone)) };
  },
};

const NO_HOUSEHOLD =
  "No household set up yet. Tell the user to open the Home page and create (or join) their household first.";

function resolveList(
  lists: { id: string; name: string }[],
  nameQuery: string | undefined,
): { id: string; name: string } | null {
  if (lists.length === 0) return null;
  if (!nameQuery) return lists.find((l) => /grocer/i.test(l.name)) ?? lists[0]!;
  const q = nameQuery.toLowerCase();
  return lists.find((l) => l.name.toLowerCase().includes(q)) ?? null;
}
