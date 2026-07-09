import { SupabaseClient } from "@supabase/supabase-js";
import { AIProvider, ChatMessage } from "@/lib/ai/types";
import { ActionFailure, ActionReceipt, AssistantResponse, Profile } from "@/lib/types";
import { recallMemories } from "@/lib/memory";
import { DEFAULT_PERSONALITY, PERSONALITIES } from "@/lib/personalities";
import { getToolDefs } from "./tools";
import { executeToolCall } from "./executor";

const MAX_HOPS = 5;

/**
 * The full NL pipeline for one user message:
 * recall → compose → reason/act loop → answer + receipts.
 */
export async function runAssistant(
  supabase: SupabaseClient,
  provider: AIProvider,
  profile: Profile,
  userMessage: string,
): Promise<AssistantResponse> {
  const memories = await recallMemories(supabase, provider, profile.id, userMessage);

  const now = new Date();
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
    `Rules:`,
    `- Resolve every actionable request into tool calls. "I need groceries" → create_task. "I ate X" → log_meal with YOUR macro estimates. Relative dates ("Thursday", "tomorrow") resolve against the current local time above.`,
    `- When the user directly states a durable fact about themselves (preference, relationship, routine, goal), call save_memory — it saves immediately, no confirmation needed.`,
    `- When YOU infer a pattern rather than being told it directly (e.g. noticing a habit from their logged data), call suggest_memory instead — it asks the user to confirm before saving, since an inference can be wrong.`,
    `- Never invent calendar event ids; fetch them with get_agenda first.`,
    `- Money: "I spent X" → log_expense, "I got paid" → log_income. For any money question ("can I afford", "how am I doing", "when can I…", "what if…") call get_finance_report or simulate_finances FIRST and reason from those numbers — never compute money math yourself. Explain the why, not just the answer.`,
    `- Household vs personal: housework and home upkeep ("vacuum every Saturday", "assign laundry to Sarah") → add_chore; personal to-dos ("call mom") → create_task. "We need X" / "we're out of X" → add_shopping_item. For any household question ("when is garbage day", "what housework do I have", "what should we buy") call get_home_report FIRST — never guess collection days or duties.`,
    `- If a tool reports a conflict or error, explain it plainly and propose a next step. NEVER claim an action succeeded unless the tool result confirms it — a tool result starting with "Error:" means that action did NOT happen.`,
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
  const tools = getToolDefs();
  const actions: ActionReceipt[] = [];
  // Failures are tracked deterministically here — the UI renders them as red
  // chips regardless of how the model chooses to phrase its reply, so a failed
  // write can never masquerade as success.
  const failures: ActionFailure[] = [];

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await provider.chat({ messages, tools });

    if (res.toolCalls.length === 0) {
      return { text: res.text.trim() || "Done.", actions, failures };
    }

    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      const outcome = await executeToolCall({ supabase, provider, profile }, call);
      if (outcome.receipt) actions.push(outcome.receipt);
      if (outcome.result.startsWith("Error:")) {
        failures.push({ tool: call.name, message: outcome.result.slice("Error:".length).trim() });
      }
      messages.push({
        role: "tool",
        content: outcome.result,
        toolCallId: call.id,
        name: call.name,
      });
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
