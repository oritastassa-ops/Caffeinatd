import { describe, expect, it } from "vitest";
import { createProvider } from "@/lib/ai";

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
});
