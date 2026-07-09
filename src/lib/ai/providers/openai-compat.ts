import {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ProviderError,
  ToolCall,
  withRetry,
} from "../types";

/**
 * One adapter for every OpenAI-dialect endpoint: OpenAI, OpenRouter,
 * NVIDIA NIM, and Ollama differ only in baseURL / key / model.
 */
export class OpenAICompatProvider implements AIProvider {
  constructor(
    readonly name: string,
    private apiKey: string,
    private baseURL: string,
    private model: string,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const messages = req.messages.map((m) => this.toWireMessage(m));
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens ?? 2048,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    return withRetry(async () => {
      const res = await fetch(`${this.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new ProviderError(
          `${this.name} ${res.status}: ${await res.text()}`,
          res.status,
          res.status === 429 || res.status >= 500,
        );
      }
      const data = (await res.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
      };
      const msg = data.choices?.[0]?.message;
      const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJSON(tc.function.arguments),
      }));
      return { text: msg?.content ?? "", toolCalls };
    });
  }

  private toWireMessage(m: ChatMessage): Record<string, unknown> {
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
    return { role: m.role, content: m.content };
  }
}

function safeParseJSON(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
