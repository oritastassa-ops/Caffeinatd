import { SupabaseClient } from "@supabase/supabase-js";
import { AIProvider, ChatMessage } from "@/lib/ai/types";
import { ActionFailure, ActionReceipt, AssistantResponse, Profile } from "@/lib/types";
import { recallMemories } from "@/lib/memory";
import { reachableChannels } from "@/lib/notifications/settings-data";
import { DEFAULT_PERSONALITY, PERSONALITIES } from "@/lib/personalities";
import { getToolDefs, ToolName } from "./tools";
import { executeToolCall } from "./executor";
import { buildSituationBrief } from "./context";

export interface RunOptions {
  /**
   * Restrict the assistant to a subset of the catalog. Lower-trust callers
   * (inbound SMS/email) pass an allow-list; it both narrows the tools offered to
   * the model AND is enforced in the executor. Omitted (the web app) = full
   * catalog. See src/lib/notifications/inbound-scope.ts.
   */
  allowedTools?: ReadonlySet<ToolName>;
}

const MAX_HOPS = 5;
/**
 * Wall-clock budget for the reason/act loop. Once spent, the next model call
 * is forced to answer (no tools) instead of exploring further — the user gets
 * a reply built on whatever already happened, never an endless think. Sized
 * for the worst legitimate flow (tool hop + slow in-tool model call), so a
 * healthy request is never cut short.
 */
const TIME_BUDGET_MS = 100_000;
/** Output cap for reasoning hops: replies are 1–3 sentences, tool args are small JSON. */
const HOP_MAX_TOKENS = 700;

/**
 * The full NL pipeline for one user message:
 * recall → compose → reason/act loop → answer + receipts.
 */
export async function runAssistant(
  supabase: SupabaseClient,
  provider: AIProvider,
  profile: Profile,
  userMessage: string,
  options: RunOptions = {},
): Promise<AssistantResponse> {
  const now = new Date();

  // One parallel round trip for all ambient context: recalled memories, the
  // channels that can actually reach the user, and the situation brief (today's
  // plan, calendar, top tasks, readiness, goals). The brief is what lets the
  // most common questions answer in one hop instead of spending a read tool.
  // Each is best-effort — a failure degrades that block, never the whole reply.
  const [memories, reachable, brief] = await Promise.all([
    recallMemories(supabase, provider, profile.id, userMessage),
    reachableChannels(supabase, profile.id).catch(() => [] as string[]),
    buildSituationBrief(supabase, profile, { now }).catch(() => ""),
  ]);

  const localNow = now.toLocaleString("en-US", {
    timeZone: profile.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // The assistant is one of a named cast (see lib/personalities.ts); the
  // persona line gives it the character's voice, everything else is shared.
  const personality = PERSONALITIES[profile.settings.communicationStyle ?? DEFAULT_PERSONALITY];

  const system = [
    `You are ${personality.name}, ${profile.display_name}'s personal secretary in the Caffeinatd app. You act, you don't chat.`,
    `Current local time: ${localNow} (timezone ${profile.timezone}).`,
    personality.persona,
    brief
      ? `${profile.display_name}'s situation right now — treat this as ground truth and answer from it directly, no tool call needed:\n${brief}`
      : "",
    `Rules:`,
    `- You ALREADY KNOW today's picture from the situation brief above (today's plan, today's and tomorrow's calendar, top open tasks, readiness, goals). Answer questions about today or tomorrow — "what's my day", "am I free at 3", "what should I do now", "what's on my calendar" — STRAIGHT from the brief, with no tool call. Only call get_agenda for OTHER dates, or to fetch an event id you need in order to modify or delete an event.`,
    `- Resolve every actionable request into tool calls. "I need groceries" → create_task. "I ate X" → log_meal with YOUR macro estimates. Relative dates ("Thursday", "tomorrow") resolve against the current local time above.`,
    `- When the day has changed — a meeting ran long, a workout was skipped, a deadline moved — and the user wants their remaining time reorganized, call replan_today. It places the remaining priorities into the real free gaps deterministically; you only relay the result.`,
    `- When the user directly states a durable fact about themselves (preference, relationship, routine, goal), call save_memory — it saves immediately, no confirmation needed.`,
    `- When YOU infer a pattern rather than being told it directly (e.g. noticing a habit from their logged data), call suggest_memory instead — it asks the user to confirm before saving, since an inference can be wrong.`,
    `- Never invent calendar event ids; fetch them with get_agenda first.`,
    `- Money: "I spent X" → log_expense, "I got paid" → log_income. For any money question ("can I afford", "how am I doing", "when can I…", "what if…") call get_finance_report or simulate_finances FIRST and reason from those numbers — never compute money math yourself. Explain the why, not just the answer.`,
    `- Household vs personal: housework and home upkeep ("vacuum every Saturday", "assign laundry to Sarah") → add_chore; personal to-dos ("call mom") → create_task. "We need X" / "we're out of X" → add_shopping_item. For any household question ("when is garbage day", "what housework do I have", "what should we buy") call get_home_report FIRST — never guess collection days or duties.`,
    `- If a tool reports a conflict or error, explain it plainly and propose a next step. NEVER claim an action succeeded unless the tool result confirms it — a tool result starting with "Error:" means that action did NOT happen.`,
    reachable.length
      ? `- Notification channels available for ${profile.display_name} right now: ${reachable.join(", ")}. Only offer to email or text when that channel is listed here; schedule_reminder/notify_me default to 'auto' (their preferences decide). If they want a channel that isn't listed, tell them to add and verify it in Settings → Notifications.`
      : `- ${profile.display_name} has NO verified notification channel yet. Do not offer to email or text them; if they ask to be reminded off-app, tell them to add a contact in Settings → Notifications first (an in-app reminder still works).`,
    `- Final replies: brief (1–3 sentences), no markdown headers, state exactly what was done.`,
    memories.length
      ? `Known about ${profile.display_name} (recalled, relevant to this message):\n${memories.map((m) => `- (${m.kind}) ${m.content}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];
  const { allowedTools } = options;
  const tools = getToolDefs().filter((t) => !allowedTools || allowedTools.has(t.name as ToolName));
  const actions: ActionReceipt[] = [];
  // Failures are tracked deterministically here — the UI renders them as red
  // chips regardless of how the model chooses to phrase its reply, so a failed
  // write can never masquerade as success.
  const failures: ActionFailure[] = [];

  const startedAt = Date.now();
  // Some models (notably Llama) re-issue a tool call they already made
  // instead of answering. Executing it again is pure latency (and can
  // duplicate writes) — replay the cached result with a nudge instead.
  const executed = new Map<string, string>();

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const lastHop = hop === MAX_HOPS - 1 || Date.now() - startedAt > TIME_BUDGET_MS;

    // Final hop gets no tools: the model MUST answer in text now.
    const res = await provider.chat({
      messages,
      tools: lastHop ? undefined : tools,
      maxTokens: HOP_MAX_TOKENS,
    });

    if (res.toolCalls.length === 0) {
      return { text: res.text.trim() || "Done.", actions, failures };
    }

    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
    let finalText: string | null = null;
    let hopFailed = false;
    for (const call of res.toolCalls) {
      const key = `${call.name}:${JSON.stringify(call.arguments)}`;
      const cached = executed.get(key);
      if (cached !== undefined) {
        messages.push({
          role: "tool",
          content: `You already called ${call.name} with these arguments. Its result was:\n${cached}\nDo not call it again — answer the user now.`,
          toolCallId: call.id,
          name: call.name,
        });
        continue;
      }
      const outcome = await executeToolCall({ supabase, provider, profile, allowedTools }, call);
      if (outcome.receipt) actions.push(outcome.receipt);
      if (outcome.result.startsWith("Error:")) {
        hopFailed = true;
        failures.push({ tool: call.name, message: outcome.result.slice("Error:".length).trim() });
      } else {
        // Only successes enter the duplicate cache — a transient failure
        // (timeout, rate limit) deserves one honest retry, not a replay.
        executed.set(key, outcome.result);
        if (outcome.finalText) finalText = outcome.finalText;
      }
      messages.push({
        role: "tool",
        content: outcome.result,
        toolCallId: call.id,
        name: call.name,
      });
    }

    // A tool produced a user-ready answer and nothing in this hop failed:
    // deliver it directly instead of asking the model to re-phrase it.
    if (finalText && !hopFailed) {
      return { text: finalText, actions, failures };
    }
  }

  // Hop budget exhausted — report what did happen rather than pretending.
  return {
    text:
      actions.length > 0
        ? "I completed the actions below, but ran out of steps before composing a summary."
        : "I couldn't complete that — try rephrasing or breaking it into smaller requests.",
    actions,
    failures,
  };
}

export async function loadProfile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error || !data) throw new Error("Profile not found — run supabase/schema.sql first.");
  return {
    id: data.id,
    display_name: data.display_name,
    timezone: data.timezone || "UTC",
    settings: data.settings ?? {},
    onboarded_at: data.onboarded_at ?? null,
  };
}
