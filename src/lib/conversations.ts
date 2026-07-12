import { SupabaseClient } from "@supabase/supabase-js";
import { ConversationMessage } from "@/lib/types";

/** Exchanges within this window continue the same conversation. */
const SESSION_WINDOW_MS = 30 * 60_000;

/**
 * Persist one assistant exchange so "Recent conversations" and universal
 * search can recall it. Appends to the current session's conversation when
 * one is fresh enough, otherwise starts a new one titled by the opening
 * message. Best-effort: failures must never break the assistant reply.
 */
export async function recordExchange(
  supabase: SupabaseClient,
  userId: string,
  userMessage: string,
  assistantText: string,
): Promise<void> {
  try {
    const at = new Date().toISOString();
    const exchange: ConversationMessage[] = [
      { role: "user", content: userMessage, at },
      { role: "assistant", content: assistantText, at },
    ];

    const { data: latest } = await supabase
      .from("ai_conversations")
      .select("id, messages, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fresh =
      latest && Date.now() - new Date(latest.updated_at).getTime() < SESSION_WINDOW_MS;

    if (fresh) {
      await supabase
        .from("ai_conversations")
        .update({
          messages: [...(latest.messages as ConversationMessage[]), ...exchange],
          updated_at: at,
        })
        .eq("id", latest.id);
    } else {
      await supabase.from("ai_conversations").insert({
        user_id: userId,
        title: userMessage.slice(0, 80),
        messages: exchange,
      });
    }
  } catch {
    // Persistence is a convenience; the reply already succeeded.
  }
}
