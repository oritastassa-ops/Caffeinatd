import type { InsightCandidate } from "./generate"; // type-only, same as ./finance
import { HomeData } from "@/lib/home/data";
import { computeChoreStats, daysSinceCategoryCompletion, isDueOn, overdueDays } from "@/lib/home/schedule";
import { collectionStatuses } from "@/lib/home/collections";

/** Deterministic household rules — same contract as every other insight domain. */
export function homeInsightCandidates(data: HomeData, today: string): InsightCandidate[] {
  const out: InsightCandidate[] = [];

  // ── Collection tonight/today (the flagship reminder) ─────────────────────
  for (const status of collectionStatuses(data.collections, today)) {
    out.push({
      domain: "home",
      message: status.label,
      reason: `Your ${status.type.replace("_", " ")} schedule has a pickup on ${status.date}.`,
      importance: 4,
      dedupKey: `home:collection:${status.date}:${status.type}`,
      expiresAt: new Date(`${status.date}T23:59:59Z`).toISOString(),
    });
  }

  // ── Overdue pileup ────────────────────────────────────────────────────────
  const overdue = data.chores.filter(
    (c) => isDueOn(c, today, data.completions) && overdueDays(c, today, data.completions) > 0,
  );
  if (overdue.length >= 3) {
    out.push({
      domain: "home",
      message: `${overdue.length} chores are overdue. Want to split them up?`,
      reason: `Oldest: ${overdue.map((c) => c.title).slice(0, 3).join(", ")}.`,
      importance: 4,
      dedupKey: `home:overdue:${today}`,
      expiresAt: new Date(`${today}T23:59:59Z`).toISOString(),
      actionPreset: "split the overdue chores between us",
    });
  }

  // ── Stale high-traffic categories ─────────────────────────────────────────
  for (const category of ["kitchen", "bathroom"] as const) {
    const days = daysSinceCategoryCompletion(category, data.chores, data.completions, today);
    if (days !== null && days >= 7) {
      out.push({
        domain: "home",
        message: `The ${category} hasn't been cleaned in ${days} days.`,
        reason: `Last ${category} chore completion was ${days} days ago.`,
        importance: 3,
        dedupKey: `home:stale:${category}:${today.slice(0, 7)}:${Math.floor(days / 7)}`, // re-fires weekly while stale
      });
    }
  }

  // ── Weekly completion milestone (positive reinforcement) ──────────────────
  const stats = computeChoreStats(data.chores, data.completions, data.members, today);
  if (stats.completedThisWeek >= 10) {
    out.push({
      domain: "home",
      message: `Your household completed ${stats.completedThisWeek} chores this week. 🏡`,
      reason: `${stats.completedThisWeek} completions in the last 7 days.`,
      importance: 1,
      dedupKey: `home:milestone:${today.slice(0, 7)}:${Math.floor(stats.completedThisWeek / 10)}`,
    });
  }

  return out;
}
