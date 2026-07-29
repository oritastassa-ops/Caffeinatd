import { z } from "zod";
import { ToolDef } from "@/lib/ai/types";

/**
 * Single source of truth for the assistant's action surface.
 * Each Zod schema is used both to validate LLM-supplied arguments at runtime
 * and (via z.toJSONSchema) as the function-calling contract sent to providers.
 */

export const toolSchemas = {
  create_task: z.object({
    title: z.string().min(1).describe("Short imperative task title"),
    notes: z.string().optional(),
    priority: z.number().int().min(1).max(4).optional()
      .describe("1=urgent, 2=high, 3=normal (default), 4=low"),
    category: z.string().optional().describe("e.g. errands, health, work, home"),
    project: z.string().optional(),
    due_at: z.string().optional().describe("Due datetime, ISO 8601 with offset"),
    recurrence: z.string().optional().describe("RRULE, e.g. FREQ=WEEKLY;BYDAY=MO"),
  }),

  complete_task: z.object({
    title_query: z.string().min(1).describe("Words from the task's title to find it"),
  }),

  list_tasks: z.object({
    include_completed: z.boolean().optional(),
  }),

  log_workout: z.object({
    title: z.string().min(1).describe("e.g. 'Push day', 'Morning run'"),
    kind: z.enum(["strength", "cardio", "mobility", "other"]),
    performed_on: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
    duration_min: z.number().int().positive().optional(),
    distance_km: z.number().positive().optional(),
    notes: z.string().optional(),
    sets: z
      .array(
        z.object({
          exercise: z.string(),
          set_no: z.number().int().positive().optional(),
          reps: z.number().int().positive().optional(),
          weight_kg: z.number().nonnegative().optional(),
        }),
      )
      .optional(),
  }),

  log_meal: z.object({
    description: z.string().min(1).describe("What was eaten, as the user said it"),
    meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
    calories: z.number().int().nonnegative().describe("Your best estimate for the whole portion"),
    protein_g: z.number().int().nonnegative(),
    carbs_g: z.number().int().nonnegative(),
    fat_g: z.number().int().nonnegative(),
    eaten_at: z.string().optional().describe("ISO 8601; defaults to now"),
  }),

  get_agenda: z.object({
    date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
    days: z.number().int().min(1).max(14).optional().describe("How many days ahead, default 1"),
  }),

  create_event: z.object({
    summary: z.string().min(1),
    date: z.string().describe("YYYY-MM-DD in the user's timezone"),
    start_time: z.string().describe("HH:MM 24h local time"),
    end_time: z.string().describe("HH:MM 24h local time"),
    location: z.string().optional(),
    description: z.string().optional(),
    recurrence: z.string().optional().describe("RRULE, e.g. FREQ=WEEKLY;BYDAY=TH"),
  }),

  update_event: z.object({
    event_id: z.string(),
    summary: z.string().optional(),
    date: z.string().optional().describe("YYYY-MM-DD"),
    start_time: z.string().optional().describe("HH:MM local"),
    end_time: z.string().optional().describe("HH:MM local"),
    location: z.string().optional(),
  }),

  delete_event: z.object({
    event_id: z.string(),
  }),

  save_memory: z.object({
    kind: z.enum(["preference", "habit", "relationship", "routine", "goal", "event"]),
    content: z.string().min(1).describe("One durable fact, written in third person"),
    importance: z.number().int().min(1).max(5).optional(),
  }),

  suggest_memory: z.object({
    kind: z.enum(["preference", "habit", "relationship", "routine", "goal", "event"]),
    content: z.string().min(1).describe("The pattern you noticed, written in third person"),
    importance: z.number().int().min(1).max(5).optional(),
  }),

  create_reminder: z.object({
    message: z.string().min(1).describe("What to remind the user about"),
    remind_at: z.string().describe("ISO 8601 datetime with offset, when the reminder should fire"),
    linked_table: z.enum(["tasks", "workouts", "meals"]).optional(),
    linked_id: z.string().optional().describe("Id of the linked task/workout/meal, if any"),
  }),

  schedule_reminder: z.object({
    message: z.string().min(1).describe("What to remind the user about, in their words"),
    remind_at: z.string().describe("ISO 8601 datetime WITH offset, when it should fire (resolve relative dates against the current local time)"),
    channel: z.enum(["auto", "email", "sms", "in_app"]).optional()
      .describe("How to deliver it. Default 'auto' — lets the user's own preferences choose. Use 'sms' ONLY if the user explicitly said to text them; never pick SMS on your own."),
    urgent: z.boolean().optional()
      .describe("true ONLY for time-critical reminders that must bypass the user's quiet hours (e.g. 'take medication at 2am'). Default false."),
  }),

  cancel_reminder: z.object({
    query: z.string().min(1).describe("Words from the reminder's message, to find it"),
  }),

  list_reminders: z.object({
    include_completed: z.boolean().optional(),
  }),

  notify_me: z.object({
    message: z.string().min(1).describe("The exact message to send the user"),
    at: z.string().optional().describe("ISO 8601 with offset to send it later; omit to send as soon as possible"),
    channel: z.enum(["auto", "email", "sms"]).optional()
      .describe("Default 'auto'. Use 'sms' ONLY if the user explicitly asked to be texted."),
  }),

  recommend_bedtime: z.object({}),

  generate_daily_plan: z.object({
    date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
  }),

  replan_today: z.object({
    until: z.string().optional()
      .describe("HH:MM 24h local time to plan up to (e.g. the day's end). Defaults to 22:00."),
  }),

  get_fitness_report: z.object({
    exercise: z.string().optional().describe("Filter to one exercise, e.g. 'Bench Press'"),
  }),

  log_expense: z.object({
    amount: z.number().positive().describe("Amount in dollars (CAD)"),
    category: z.enum([
      "housing", "food", "transportation", "health", "entertainment", "education",
      "subscriptions", "travel", "shopping", "utilities", "savings", "investments", "other",
    ]),
    description: z.string().min(1).describe("What it was, as the user said it"),
    occurred_on: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
    recurrence: z.string().optional().describe("For recurring bills: FREQ=WEEKLY|MONTHLY|YEARLY[;INTERVAL=n]"),
  }),

  log_income: z.object({
    amount: z.number().positive().describe("Amount in dollars (CAD)"),
    category: z.enum(["salary", "freelance", "scholarship", "business", "dividends", "gift", "other"]),
    description: z.string().min(1),
    occurred_on: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
    recurrence: z.string().optional().describe("For recurring income: FREQ=WEEKLY|MONTHLY|YEARLY[;INTERVAL=n]"),
  }),

  create_finance_goal: z.object({
    title: z.string().min(1).describe("e.g. 'Emergency fund', 'House down payment'"),
    target_amount: z.number().positive(),
    current_amount: z.number().nonnegative().optional(),
    monthly_contribution: z.number().nonnegative().optional(),
    deadline: z.string().optional().describe("YYYY-MM-DD, if the user has one"),
    priority: z.number().int().min(1).max(5).optional(),
  }),

  get_finance_report: z.object({}),

  simulate_finances: z.object({
    extra_monthly_savings: z.number().optional().describe("Δ monthly savings; negative = saving less"),
    income_change: z.number().optional().describe("Δ monthly income, e.g. a raise"),
    expense_change: z.number().optional().describe("Δ monthly recurring expenses, e.g. new rent"),
    one_time_purchase: z.number().optional().describe("Immediate one-time spend, e.g. a $2000 laptop"),
  }),

  add_chore: z.object({
    title: z.string().min(1).describe("e.g. 'Vacuum living room'"),
    cadence: z.enum(["daily", "weekly", "monthly", "one_time"]),
    category: z.enum([
      "kitchen", "bathroom", "bedroom", "living", "laundry", "outdoor",
      "pets", "plants", "maintenance", "errand", "other",
    ]),
    assigned_to_name: z.string().optional().describe("Household member name, if the user said who"),
    rotate: z.boolean().optional().describe("true for 'alternate/take turns' requests"),
    due_date: z.string().optional().describe("YYYY-MM-DD; for one_time chores or a specific start day"),
  }),

  complete_chore: z.object({
    title_query: z.string().min(1).describe("Words from the chore's title"),
    completed_by_name: z.string().optional().describe("Who did it, if not the current user"),
  }),

  list_chores: z.object({
    filter: z.enum(["today", "overdue", "all"]).optional(),
  }),

  add_shopping_item: z.object({
    item: z.string().min(1).describe("The item, e.g. 'milk'"),
    quantity: z.string().optional().describe("As said: '2 cartons', '500g', '6'"),
    list_name: z.string().optional().describe("Which list; defaults to Groceries"),
    category: z.enum([
      "produce", "bakery", "dairy", "frozen", "meat", "seafood", "pantry",
      "snacks", "drinks", "cleaning", "toiletries", "pets", "other",
    ]).describe("YOUR categorization of the item"),
  }),

  check_off_shopping: z.object({
    item_query: z.string().optional().describe("Omit to check off the ENTIRE list ('I bought everything')"),
    list_name: z.string().optional(),
  }),

  remove_shopping_item: z.object({
    item_query: z.string().min(1),
    list_name: z.string().optional(),
  }),

  set_collection_schedule: z.object({
    type: z.enum(["garbage", "recycling", "compost", "yard_waste", "bulk", "hazardous"]),
    day_of_week: z.number().int().min(0).max(6).describe("0=Sunday .. 6=Saturday"),
    frequency: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  }),

  get_home_report: z.object({}),
} as const;

export type ToolName = keyof typeof toolSchemas;

const toolDescriptions: Record<ToolName, string> = {
  create_task: "Create a task/reminder. Use for anything the user needs to do or be reminded of.",
  complete_task: "Mark an existing task as done, found by words from its title.",
  list_tasks: "List the user's open tasks.",
  log_workout: "Log a workout the user performed, with sets/reps/weight or cardio details.",
  log_meal:
    "Log food the user ate. YOU estimate calories and macros for the described portion — never ask the user for numbers.",
  get_agenda: "Read calendar events for a day or range. Use before scheduling to check context.",
  create_event:
    "Create a Google Calendar event. Conflicts are detected automatically — if the result reports a conflict, tell the user and propose alternatives instead of retrying blindly.",
  update_event: "Reschedule or edit an existing calendar event by id (get ids via get_agenda).",
  delete_event: "Delete a calendar event by id (get ids via get_agenda).",
  save_memory:
    "Store a durable fact the user directly told you (preference, habit, relationship, routine, goal, important event). Saves immediately, no confirmation.",
  suggest_memory:
    "Propose a durable fact YOU inferred from patterns in their data rather than something they stated. Shown to the user as a Remember/Don't-remember choice before it's saved.",
  create_reminder: "Legacy in-app-only reminder (surfaces in the app, no email/SMS). Prefer schedule_reminder for anything the user should be actively notified about.",
  schedule_reminder:
    "Schedule a reminder that is actually DELIVERED (email/SMS per the user's preferences) at a time. Use this for 'remind me to…'. Let channel default to 'auto' unless the user names a channel.",
  cancel_reminder: "Cancel a pending reminder, found by words from its message. Also stops any queued delivery.",
  list_reminders: "List the user's upcoming (optionally completed) reminders.",
  notify_me:
    "Send the user a one-off message now or at a stated time that ISN'T a recurring reminder ('text me the gym summary after my workout'). Use sparingly — never send unprompted or repeatedly.",
  recommend_bedtime: "Compute tonight's recommended bedtime from tomorrow's calendar and sleep goal.",
  generate_daily_plan: "Generate (or regenerate) the structured daily plan for a date.",
  replan_today:
    "Reorganize the REMAINDER of today when the plan slipped (a meeting ran long, a workout was skipped, a deadline moved). Places the top open tasks into the real free gaps between now and the day's end, deterministically — you only relay what it scheduled. Use this for 're-plan my afternoon' / 'my day got derailed, fix it'.",
  get_fitness_report:
    "Read-only fitness digest: recovery by muscle group, strength progression (estimated 1RM trend) per exercise, training consistency, and active strength goal progress. Call this before answering any question about training, progress, recovery, or plateaus — never guess these numbers.",
  log_expense:
    "Record money the user spent. 'I spent $40 on groceries' → amount 40, category food. Include recurrence only when the user says it repeats (rent, subscriptions).",
  log_income: "Record money the user received (salary, freelance payment, gift…).",
  create_finance_goal: "Create a savings/financial goal the user wants to work toward.",
  get_finance_report:
    "Read-only finance digest: net worth, cash available, savings rate, monthly averages, goal forecasts with ETAs, and the financial health score with every factor explained. Call this before answering any money question — never guess these numbers.",
  simulate_finances:
    "Deterministic what-if projection. Use for 'can I afford X', 'what if I save more', 'what if my salary changes': pass the deltas, get before/after cash curves, goal ETAs, and health score. Explain the trade-offs the result shows; never compute money math yourself.",
  add_chore:
    "Create a household chore (recurring or one-time housework, assignable to a household member). Personal to-dos stay tasks — this is for the house.",
  complete_chore: "Mark a household chore done, found by words from its title.",
  list_chores: "List household chores due today, overdue, or all.",
  add_shopping_item:
    "Add an item to a household shopping list. 'We need milk' / 'we're out of X' → this, with YOUR category.",
  check_off_shopping:
    "Check off shopping items. Omit item_query to complete a whole list ('I bought everything').",
  remove_shopping_item: "Remove an item from a shopping list without buying it.",
  set_collection_schedule:
    "Save the household's municipal pickup schedule. 'Garbage day is Tuesday' → type garbage, day 2.",
  get_home_report:
    "Read-only household digest: chores due/overdue with assignees, garbage/recycling dates, shopping lists, completion stats. Call before answering any household question — never guess dates or duties.",
};

// Gemini's function-calling schema only supports a small subset of JSON
// Schema. Zod's .positive()/.nonnegative()/.int() etc. emit these keywords;
// our own Zod validation still enforces them when the tool call comes back,
// so it's safe to drop them from what we send the provider.
const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "additionalProperties",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minimum",
  "maximum",
]);

/** Strip JSON-Schema keys some providers (notably Gemini) reject. */
function sanitize(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYS.has(k)) continue;
    if (k === "properties" && typeof v === "object" && v !== null) {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, sanitize(pv)]),
      );
    } else if (k === "items") {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function getToolDefs(): ToolDef[] {
  return (Object.keys(toolSchemas) as ToolName[]).map((name) => ({
    name,
    description: toolDescriptions[name],
    parameters: sanitize(z.toJSONSchema(toolSchemas[name])),
  }));
}
