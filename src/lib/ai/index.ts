import { AIProvider } from "./types";
import { GeminiProvider } from "./providers/gemini";
import { OpenAICompatProvider } from "./providers/openai-compat";
import { AnthropicProvider } from "./providers/anthropic";

export type ProviderName = "gemini" | "openai" | "anthropic" | "openrouter" | "nim" | "ollama";

export interface ProviderEnv {
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

const OPENAI_COMPAT_DEFAULTS: Record<string, { baseURL: string; model: string }> = {
  openai: { baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct" },
  nim: { baseURL: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.3-70b-instruct" },
  ollama: { baseURL: "http://localhost:11434/v1", model: "llama3.1" },
};

/**
 * Provider factory — the only place that maps AI_PROVIDER to a concrete
 * implementation. OpenRouter, NIM, and Ollama all speak the OpenAI wire
 * format, so they share OpenAICompatProvider with different defaults.
 */
export function createProvider(env: ProviderEnv = process.env as ProviderEnv): AIProvider {
  const name = (env.AI_PROVIDER ?? "gemini").toLowerCase();

  if (name === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? "gemini-2.0-flash");
  }
  if (name === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? "claude-sonnet-5");
  }
  const compat = OPENAI_COMPAT_DEFAULTS[name];
  if (compat) {
    const key = env.OPENAI_API_KEY ?? (name === "ollama" ? "ollama" : undefined);
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    return new OpenAICompatProvider(
      name,
      key,
      env.OPENAI_BASE_URL ?? compat.baseURL,
      env.OPENAI_MODEL ?? compat.model,
    );
  }
  throw new Error(`Unknown AI_PROVIDER "${name}"`);
}

let cached: AIProvider | null = null;
export function getProvider(): AIProvider {
  if (!cached) cached = createProvider();
  return cached;
}
