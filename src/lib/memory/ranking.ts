/**
 * Combined recall score: similarity + importance + recency + usage frequency.
 * Kept as a pure function (no DB access) so the weighting can be unit-tested
 * without a live pgvector query — the vector search itself only narrows the
 * candidate pool; this decides the final order within it.
 */

export interface ScorableMemory {
  similarity: number; // 0–1, from pgvector cosine distance
  importance: number; // 1–5
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
}

const WEIGHTS = { similarity: 0.5, importance: 0.2, recency: 0.15, usage: 0.15 };

export function scoreMemory(m: ScorableMemory, now = Date.now()): number {
  const importanceNorm = (m.importance - 1) / 4; // 1–5 → 0–1
  const daysSinceUse = (now - new Date(m.last_used_at ?? m.created_at).getTime()) / 86_400_000;
  const recencyNorm = 1 / (1 + Math.max(daysSinceUse, 0) / 14); // half-life-ish decay over ~2 weeks
  const usageNorm = Math.min(m.usage_count, 10) / 10; // saturates at 10 uses

  return (
    WEIGHTS.similarity * m.similarity +
    WEIGHTS.importance * importanceNorm +
    WEIGHTS.recency * recencyNorm +
    WEIGHTS.usage * usageNorm
  );
}

export function rankMemories<T extends ScorableMemory>(memories: T[], limit: number, now = Date.now()): T[] {
  return [...memories].sort((a, b) => scoreMemory(b, now) - scoreMemory(a, now)).slice(0, limit);
}
