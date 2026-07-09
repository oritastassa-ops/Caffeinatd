import { Chore, ChoreCompletion, HouseholdMember } from "@/lib/types";
import { occurrencesBetween } from "@/lib/finance/cashflow"; // same tested RRULE subset, no duplication

/**
 * Deterministic chore scheduling — the LLM never computes a due date.
 * Cadence semantics:
 *  - daily: due every day unless completed that day
 *  - weekly/monthly: due on occurrence days of `recurrence` (anchored at anchor_date);
 *    an occurrence is satisfied by a completion on-or-after it (before the next one)
 *  - one_time: due once anchor_date arrives, until completed
 */

function defaultRecurrence(chore: Chore): string | null {
  if (chore.recurrence) return chore.recurrence;
  if (chore.cadence === "weekly") return "FREQ=WEEKLY";
  if (chore.cadence === "monthly") return "FREQ=MONTHLY";
  return null;
}

function completionsFor(chore: Chore, completions: ChoreCompletion[]): string[] {
  return completions
    .filter((c) => c.chore_id === chore.id)
    .map((c) => c.completed_on)
    .sort();
}

/** The most recent occurrence on-or-before `date`, or null if none yet. */
function lastOccurrenceOnOrBefore(chore: Chore, date: string): string | null {
  const rec = defaultRecurrence(chore);
  if (!rec) return chore.anchor_date <= date ? chore.anchor_date : null;
  if (chore.anchor_date > date) return null;
  const dates = occurrencesBetween(
    chore.anchor_date,
    rec,
    // occurrencesBetween's window is (after, until] — step one day back so the anchor itself counts.
    prevDay(chore.anchor_date),
    date,
  );
  return dates.length > 0 ? dates[dates.length - 1]! : null;
}

export function isDueOn(chore: Chore, date: string, completions: ChoreCompletion[]): boolean {
  if (chore.archived_at) return false;
  const done = completionsFor(chore, completions);

  if (chore.cadence === "one_time") {
    return chore.anchor_date <= date && done.length === 0;
  }
  if (chore.cadence === "daily") {
    return chore.anchor_date <= date && !done.includes(date);
  }
  // weekly / monthly: the latest occurrence up to `date` must be covered by a
  // completion on-or-after it.
  const occurrence = lastOccurrenceOnOrBefore(chore, date);
  if (!occurrence) return false;
  return !done.some((d) => d >= occurrence && d <= date);
}

/** Days the current uncovered occurrence has been waiting (0 = due today, not overdue). */
export function overdueDays(chore: Chore, today: string, completions: ChoreCompletion[]): number {
  if (!isDueOn(chore, today, completions)) return 0;
  if (chore.cadence === "daily") return 0; // a daily chore is only ever due "today"
  const occurrence =
    chore.cadence === "one_time" ? chore.anchor_date : lastOccurrenceOnOrBefore(chore, today)!;
  return Math.max(0, Math.floor((toTime(today) - toTime(occurrence)) / 86_400_000));
}

/**
 * Rotation ("alternate who cleans the bathroom"): the member after the last
 * completer, in member order; falls back to the assigned member, then the
 * first member. Stateless and deterministic — recomputable from history.
 */
export function nextAssignee(
  chore: Chore,
  members: HouseholdMember[],
  completions: ChoreCompletion[],
): HouseholdMember | null {
  if (members.length === 0) return null;
  const explicit = members.find((m) => m.id === chore.assigned_member_id) ?? null;
  if (!chore.rotate_assignment) return explicit;

  const history = completions
    .filter((c) => c.chore_id === chore.id && c.member_id)
    .sort((a, b) => (a.completed_on < b.completed_on ? 1 : -1));
  const lastMemberId = history[0]?.member_id;
  if (!lastMemberId) return explicit ?? members[0]!;
  const lastIndex = members.findIndex((m) => m.id === lastMemberId);
  if (lastIndex === -1) return explicit ?? members[0]!;
  return members[(lastIndex + 1) % members.length]!;
}

/** Powers "the kitchen hasn't been cleaned in 9 days" — null when that category has no history. */
export function daysSinceCategoryCompletion(
  category: string,
  chores: Chore[],
  completions: ChoreCompletion[],
  today: string,
): number | null {
  const choreIds = new Set(chores.filter((c) => c.category === category).map((c) => c.id));
  const dates = completions.filter((c) => choreIds.has(c.chore_id)).map((c) => c.completed_on);
  if (dates.length === 0) return null;
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  return Math.max(0, Math.floor((toTime(today) - toTime(latest)) / 86_400_000));
}

export interface ChoreStats {
  completedThisWeek: number;
  completionRatePercent: number | null; // completions ÷ due-occurrences, trailing 30 days
  mostActiveMemberId: string | null;
}

/** Trailing analytics from history alone — nothing stored. */
export function computeChoreStats(
  chores: Chore[],
  completions: ChoreCompletion[],
  members: HouseholdMember[],
  today: string,
): ChoreStats {
  const weekAgo = shiftDays(today, -7);
  const completedThisWeek = completions.filter((c) => c.completed_on > weekAgo && c.completed_on <= today).length;

  // Expected occurrences in the trailing 30 days, per chore, vs completions.
  const monthAgo = shiftDays(today, -30);
  let expected = 0;
  for (const chore of chores) {
    if (chore.cadence === "one_time") continue; // not a rate-able obligation
    if (chore.cadence === "daily") {
      const start = chore.anchor_date > monthAgo ? chore.anchor_date : monthAgo;
      expected += Math.max(0, Math.floor((toTime(today) - toTime(start)) / 86_400_000));
    } else {
      const rec = defaultRecurrence(chore)!;
      expected += occurrencesBetween(chore.anchor_date, rec, monthAgo, today).length;
    }
  }
  const done30 = completions.filter((c) => c.completed_on > monthAgo).length;
  const completionRatePercent = expected > 0 ? Math.min(100, Math.round((done30 / expected) * 100)) : null;

  const counts = new Map<string, number>();
  for (const c of completions) {
    if (c.member_id) counts.set(c.member_id, (counts.get(c.member_id) ?? 0) + 1);
  }
  let mostActiveMemberId: string | null = null;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best && members.some((m) => m.id === id)) {
      best = n;
      mostActiveMemberId = id;
    }
  }
  return { completedThisWeek, completionRatePercent, mostActiveMemberId };
}

function toTime(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getTime();
}
function shiftDays(dateStr: string, days: number): string {
  return new Date(toTime(dateStr) + days * 86_400_000).toISOString().slice(0, 10);
}
function prevDay(dateStr: string): string {
  return shiftDays(dateStr, -1);
}
