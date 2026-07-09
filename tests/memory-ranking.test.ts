import { describe, expect, it } from "vitest";
import { rankMemories, scoreMemory } from "@/lib/memory/ranking";

const NOW = new Date("2026-07-06T12:00:00Z").getTime();

function mem(overrides: Partial<Parameters<typeof scoreMemory>[0]>) {
  return {
    similarity: 0.6,
    importance: 3,
    usage_count: 0,
    last_used_at: null as string | null,
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("memory ranking", () => {
  it("higher similarity scores higher, all else equal", () => {
    const low = scoreMemory(mem({ similarity: 0.3 }), NOW);
    const high = scoreMemory(mem({ similarity: 0.9 }), NOW);
    expect(high).toBeGreaterThan(low);
  });

  it("higher importance scores higher at equal similarity", () => {
    const low = scoreMemory(mem({ importance: 1 }), NOW);
    const high = scoreMemory(mem({ importance: 5 }), NOW);
    expect(high).toBeGreaterThan(low);
  });

  it("recently used beats long-stale, at equal similarity/importance", () => {
    const stale = scoreMemory(mem({ last_used_at: "2026-05-01T00:00:00Z" }), NOW);
    const fresh = scoreMemory(mem({ last_used_at: "2026-07-05T00:00:00Z" }), NOW);
    expect(fresh).toBeGreaterThan(stale);
  });

  it("frequently used beats rarely used, at equal similarity/importance", () => {
    const rare = scoreMemory(mem({ usage_count: 0 }), NOW);
    const frequent = scoreMemory(mem({ usage_count: 10 }), NOW);
    expect(frequent).toBeGreaterThan(rare);
  });

  it("a strong-but-old-and-unimportant memory can lose to a weaker-but-fresh one", () => {
    const strongButStale = mem({ similarity: 0.7, importance: 1, usage_count: 0, last_used_at: "2026-01-01T00:00:00Z" });
    const weakButFreshImportant = mem({ similarity: 0.56, importance: 5, usage_count: 10, last_used_at: "2026-07-06T11:00:00Z" });
    expect(scoreMemory(weakButFreshImportant, NOW)).toBeGreaterThan(scoreMemory(strongButStale, NOW));
  });

  it("rankMemories sorts descending and respects the limit", () => {
    const items = [mem({ similarity: 0.5 }), mem({ similarity: 0.9 }), mem({ similarity: 0.7 })];
    const ranked = rankMemories(items, 2, NOW);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.similarity).toBe(0.9);
    expect(ranked[1]!.similarity).toBe(0.7);
  });
});
