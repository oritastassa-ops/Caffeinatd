import { describe, expect, it, vi } from "vitest";
import { createProvider } from "@/lib/ai";
import { FallbackProvider } from "@/lib/ai/providers/fallback";
import { AIProvider, ProviderError } from "@/lib/ai/types";

describe("provider factory", () => {
  it("defaults to gemini", () => {
    const p = createProvider({ GEMINI_API_KEY: "k" });
    expect(p.name).toBe("gemini");
    expect(p.embed).toBeDefined();
  });

  it("builds each OpenAI-compatible provider from one adapter", () => {
    for (const name of ["openai", "openrouter", "nim"]) {
      const p = createProvider({ AI_PROVIDER: name, OPENAI_API_KEY: "k" });
      expect(p.name).toBe(name);
    }
  });

  it("ollama needs no API key", () => {
    const p = createProvider({ AI_PROVIDER: "ollama" });
    expect(p.name).toBe("ollama");
  });

  it("builds anthropic", () => {
    const p = createProvider({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" });
    expect(p.name).toBe("anthropic");
  });

  it("fails loudly on a missing key or unknown provider", () => {
    expect(() => createProvider({})).toThrow(/GEMINI_API_KEY/);
    expect(() => createProvider({ AI_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
    expect(() => createProvider({ AI_PROVIDER: "clippy" })).toThrow(/Unknown/);
  });

  it("wraps the primary with a fallback when AI_FALLBACK_PROVIDER is set", () => {
    const p = createProvider({
      AI_PROVIDER: "nim",
      OPENAI_API_KEY: "k",
      AI_FALLBACK_PROVIDER: "gemini",
      GEMINI_API_KEY: "g",
    });
    expect(p.name).toBe("nim+gemini");
    // Gemini brings embeddings back even though NIM has none.
    expect(p.embed).toBeDefined();
  });

  it("ignores a fallback whose key is missing (primary still works)", () => {
    const p = createProvider({
      AI_PROVIDER: "nim",
      OPENAI_API_KEY: "k",
      AI_FALLBACK_PROVIDER: "gemini",
    });
    expect(p.name).toBe("nim");
  });
});

describe("fallback provider", () => {
  const req = { messages: [{ role: "user" as const, content: "hi" }] };
  const ok = { text: "done", toolCalls: [] };

  function fake(name: string, fails: boolean): AIProvider {
    return {
      name,
      chat: vi.fn(async () => {
        if (fails) throw new ProviderError(`${name} timed out`, 408, false);
        return ok;
      }),
    };
  }

  it("re-runs a failed request on the secondary", async () => {
    const primary = fake("nim", true);
    const secondary = fake("gemini", false);
    const p = new FallbackProvider(primary, secondary);
    await expect(p.chat(req)).resolves.toEqual(ok);
    expect(primary.chat).toHaveBeenCalledOnce();
    expect(secondary.chat).toHaveBeenCalledOnce();
  });

  it("never touches the secondary when the primary succeeds", async () => {
    const primary = fake("nim", false);
    const secondary = fake("gemini", false);
    const p = new FallbackProvider(primary, secondary);
    await expect(p.chat(req)).resolves.toEqual(ok);
    expect(secondary.chat).not.toHaveBeenCalled();
  });

  it("surfaces the secondary's error when both fail", async () => {
    const p = new FallbackProvider(fake("nim", true), fake("gemini", true));
    await expect(p.chat(req)).rejects.toThrow(/gemini timed out/);
  });
});
