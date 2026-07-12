import {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ProviderError,
  ToolCall,
  withRetry,
} from "../types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini 429 bodies often carry a RetryInfo like {"retryDelay":"20s"}. */
function parseRetryDelayMs(res: Response, bodyText: string): number | undefined {
  const header = res.headers.get("retry-after");
  if (header) return Number(header) * 1000;
  const match = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Number(match[1]) * 1000 : undefined;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function toGeminiContents(messages: ChatMessage[]): { system: string; contents: GeminiContent[] } {
  let system = "";
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system += (system ? "\n\n" : "") + m.content;
    } else if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      }
      contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.name ?? "tool",
              response: { result: m.content },
            },
          },
        ],
      });
    } else {
      contents.push({ role: "user", parts: [{ text: m.content }] });
    }
  }
  return { system, contents };
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  constructor(
    private apiKey: string,
    private model = "gemini-2.0-flash",
  ) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const { system, contents } = toGeminiContents(req.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxTokens ?? 2048,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (req.tools?.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    return withRetry(async () => {
      const res = await fetch(`${BASE}/models/${this.model}:generateContent?key=${this.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      }).catch((err) => {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new ProviderError("gemini timed out after 45s", 408, false);
        }
        throw err;
      });
      if (!res.ok) {
        const bodyText = await res.text();
        throw new ProviderError(
          `Gemini ${res.status}: ${bodyText}`,
          res.status,
          res.status === 429 || res.status >= 500,
          res.status === 429 ? parseRetryDelayMs(res, bodyText) : undefined,
        );
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] } }[];
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("");
      const toolCalls: ToolCall[] = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({
          id: `call_${Date.now()}_${i}`,
          name: p.functionCall!.name,
          arguments: p.functionCall!.args ?? {},
        }));
      return { text, toolCalls };
    });
  }

  async embed(text: string): Promise<number[]> {
    return withRetry(async () => {
      const res = await fetch(`${BASE}/models/text-embedding-004:embedContent?key=${this.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!res.ok) {
        const bodyText = await res.text();
        throw new ProviderError(
          `Gemini embed ${res.status}: ${bodyText}`,
          res.status,
          res.status === 429 || res.status >= 500,
          res.status === 429 ? parseRetryDelayMs(res, bodyText) : undefined,
        );
      }
      const data = (await res.json()) as { embedding: { values: number[] } };
      return data.embedding.values;
    });
  }
}
