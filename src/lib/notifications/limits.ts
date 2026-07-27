/**
 * SMS spend-cap math. Pure functions over counts and caps, with the
 * timezone-sensitive part — which local day/month a moment falls in — isolated
 * so it can be tested across midnight and DST boundaries without a database.
 *
 * SMS is the only channel that costs money per message, so a runaway loop is a
 * billing incident. Caps are enforced at ENQUEUE (don't queue what we'd refuse
 * to send) against the count already sent this period PLUS the count still
 * in-flight, so a burst enqueued before anything sends is still bounded. The
 * worker keeps a global per-run cap as a second line of defense.
 */

export interface SmsCaps {
  /** Per-user messages per local day. <= 0 means unlimited. */
  daily: number;
  /** Per-user messages per local calendar month. <= 0 means unlimited. */
  monthly: number;
}

/** The user-LOCAL calendar day, `YYYY-MM-DD`. en-CA yields ISO ordering. */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The user-LOCAL month prefix, `YYYY-MM` — the bucket a monthly cap sums over. */
export function localMonth(now: Date, timeZone: string): string {
  return localDay(now, timeZone).slice(0, 7);
}

/**
 * Half-open `[start, endExclusive)` date range covering the user-local month of
 * `now`, as `YYYY-MM-DD` strings — used to sum the daily spend rows in a month.
 */
export function monthRange(now: Date, timeZone: string): { start: string; endExclusive: string } {
  const prefix = localMonth(now, timeZone); // YYYY-MM
  const [year, month] = prefix.split("-").map(Number) as [number, number];
  const start = `${prefix}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, endExclusive };
}

/** `true` when `cap` is a real limit (positive); <= 0 disables enforcement. */
export function capEnforced(cap: number): boolean {
  return Number.isFinite(cap) && cap > 0;
}

/** A used count is over an enforced cap when it has reached (not just passed) it. */
export function atOrOverCap(used: number, cap: number): boolean {
  return capEnforced(cap) && used >= cap;
}

export interface CapUsage {
  /** SMS already counted (sent) this local day. */
  sentToday: number;
  /** SMS already counted (sent) this local month. */
  sentMonth: number;
  /** SMS queued this period but not yet sent (pending/sending) — bounds bursts. */
  inFlight: number;
}

export interface CapDecision {
  blocked: boolean;
  /** Which limit tripped, for the skip reason / logs. */
  reason: "daily" | "monthly" | null;
}

/**
 * Decide whether one more SMS would breach a cap. In-flight messages count
 * toward both windows because they will (barring failure) become sends.
 */
export function evaluateCaps(usage: CapUsage, caps: SmsCaps): CapDecision {
  const dayUsed = usage.sentToday + usage.inFlight;
  const monthUsed = usage.sentMonth + usage.inFlight;
  if (atOrOverCap(dayUsed, caps.daily)) return { blocked: true, reason: "daily" };
  if (atOrOverCap(monthUsed, caps.monthly)) return { blocked: true, reason: "monthly" };
  return { blocked: false, reason: null };
}

/**
 * Quiet-hours hard floor for SMS: this phase DECLARES the constraint; Phase 4
 * owns the scheduling math that enforces it. No non-urgent SMS between 22:00 and
 * 08:00 local. A user may narrow this window (e.g. 23:00–07:00) but not remove
 * it, because SMS is the one channel that wakes people up.
 */
export const SMS_QUIET_FLOOR = { startHourLocal: 22, endHourLocal: 8 } as const;
