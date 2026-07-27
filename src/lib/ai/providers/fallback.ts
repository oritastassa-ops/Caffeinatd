import { AIProvider, ChatRequest, ChatResult, ProviderError } from "../types";

/**
 * Resilience wrapper: try the primary provider; when it fails with a
 * provider-level error (timeout, rate limit, 5xx — anything that already
 * survived the primary's own retries), transparently re-run the request on
 * the secondary. Free/community endpoints (NIM, OpenRouter) go through
 * multi-minute brownouts where requests queue with zero bytes sent — a
 * configured fallback turns "the assistant never finishes" into "the
 * assistant answered a few seconds later than usual".
 *
 * Embeddings delegate to whichever provider offers them (memory recall
 * degrades to keyword search only when neither does).
 */
export class FallbackProvider implements AIProvider {
  readonly name: string;
  embed?: (text: string) => Promise<number[]>;

  constructor(
    private primary: AIProvider,
    private secondary: AIProvider,
  ) {
    this.name = `${primary.name}+${secondary.name}`;
    const embedder = primary.embed ? primary : secondary.embed ? secondary : null;
    if (embedder) this.embed = (text) => embedder.embed!(text);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    try {
      return await this.primary.chat(req);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      console.warn(
        `[ai] ${this.primary.name} failed (${err.status ?? "?"}: ${err.message.slice(0, 120)}) — falling back to ${this.secondary.name}`,
      );
      return this.secondary.chat(req);
    }
  }
}
