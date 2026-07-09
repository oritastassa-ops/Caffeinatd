import {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ProviderError,
  ToolCall,
  withRetry,
} from "../types";

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  constructor(
    private apiKey: string,
    private model = "claude-sonnet-5",
  ) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    let system = "";
    const messages: { role: "user" | "assistant"; content: AnthropicBlock[] }[] = [];
    for (const m of req.messages) {
      if (m.role === "system") {
        system += (system ? "\n\n" : "") + m.content;
      } else if (m.role === "assistant") {
        const blocks: AnthropicBlock[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? []) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
        messages.push({ role: "assistant", content: blocks });
      } else if (m.role === "tool") {
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }],
        });
      } else {
        messages.push({ role: "user", content: [{ type: "text", text: m.content }] });
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.4,
      messages,
    };
    if (system) body.system = system;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return withRetry(async () => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new ProviderError(
          `Anthropic ${res.status}: ${await res.text()}`,
          res.status,
          res.status === 429 || res.status >= 500,
        );
      }
      const data = (await res.json()) as { content?: AnthropicBlock[] };
      let text = "";
      const toolCalls: ToolCall[] = [];
      for (const block of data.content ?? []) {
        if (block.type === "text") text += block.text;
        if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
        }
      }
      return { text, toolCalls };
    });
  }
}
