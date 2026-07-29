import { ToolName } from "@/lib/pipeline/tools";

/**
 * The tools an inbound reply (SMS or email) is allowed to invoke.
 *
 * WHY AN ALLOW-LIST, AND WHY OPT-IN
 * ---------------------------------
 * A sender address is a claim, not a credential — caller ID and email `From`
 * are both trivially spoofed, and a verified contact can be a compromised
 * mailbox or a recycled phone number. So inbound is a lower-trust channel than
 * the web app, and its action surface must be strictly smaller.
 *
 * This is a single, typed allow-list — `Set<ToolName>`, so every entry is a real
 * catalog tool and names can't drift from `tools.ts`. It is deliberately OPT-IN:
 * a new capability added to the catalog is NOT reachable from a spoofable
 * channel until someone adds it here on purpose. An opt-out list would silently
 * widen the blast radius every time the assistant gained a tool.
 *
 * WHY THE SAME SET FOR BOTH CHANNELS
 * ----------------------------------
 * Email's SPF/DKIM authenticate the sending *server*, not the *human*; they say
 * nothing about a mailbox compromise or a forwarded thread. The identity proof
 * in both channels is the `verified_at` contact match, which is the same
 * strength for each — so email earns no wider surface than SMS.
 *
 * THE LINE: reversible-or-read-only IN, irreversible-or-third-party-fanning OUT
 * ----------------------------------------------------------------------------
 * Every mutating tool already returns an undoable receipt, so the only actions
 * worth withholding are the ones a receipt can't take back. Excluded, and why:
 *   - delete_event   — irreversible, and emails a cancellation to other
 *                      attendees. A spoofed "cancel my 3pm" is the exact abuse.
 *   - suggest_memory — needs an interactive Remember/Don't-remember surface that
 *                      a text thread doesn't have; it would be a dead no-op.
 * `update_event` and `create_event` stay IN — "move gym to 6" is the feature's
 * whole point, and both carry receipts.
 */
export const INBOUND_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  // Capture + read
  "create_task",
  "complete_task",
  "list_tasks",
  "get_agenda",
  "log_workout",
  "log_meal",
  "log_expense",
  "log_income",
  "get_fitness_report",
  "get_finance_report",
  "simulate_finances",
  "get_home_report",
  "recommend_bedtime",
  // Reversible writes (all carry undo receipts)
  "create_event",
  "update_event",
  "create_reminder",
  "schedule_reminder",
  "cancel_reminder",
  "list_reminders",
  "notify_me",
  "save_memory",
  "create_finance_goal",
  "add_chore",
  "complete_chore",
  "list_chores",
  "add_shopping_item",
  "check_off_shopping",
  "remove_shopping_item",
  "set_collection_schedule",
  "generate_daily_plan",
]);

export function isInboundTool(name: string): name is ToolName {
  return INBOUND_TOOLS.has(name as ToolName);
}
