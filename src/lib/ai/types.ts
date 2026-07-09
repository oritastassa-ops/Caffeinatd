/** Provider-agnostic chat/tool contracts. The pipeline depends only on this file. */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool messages: which call this result answers. */
  toolCallId?: string;
  /** Tool name, on tool messages. */
  name?: string;
}

/** JSON Schema subset every provider dialect accepts. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
}

export interface AIProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  /** Optional; when absent, memory recall falls back to keyword search. */
  embed?(text: string): Promise<number[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    /** Server-advised wait before retrying (Retry-After / retryDelay), in ms. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// Gemini's free tier advises waits of 10–30s on 429 (per-minute quota).
// Refusing to wait that long turns every burst into a user-facing error, so
// we ride out a single advised wait up to 30s — routes that call the
// provider declare `maxDuration = 60` so the wait fits the serverless
// budget. A total budget caps stacked retries so a request can't hang.
const MAX_INLINE_WAIT_MS = 30_000;
const MAX_TOTAL_WAIT_MS = 45_000;

/** Retry on 429/5xx, honoring the provider's advised wait when present. */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  let waited = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!(err instanceof ProviderError) || !err.retryable) throw err;

      const wait = err.retryAfterMs ?? 800 * 2 ** attempt;
      if (attempt === retries || wait > MAX_INLINE_WAIT_MS || waited + wait > MAX_TOTAL_WAIT_MS) {
        throw err;
      }
      waited += wait;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}
