/**
 * Calendar-date arithmetic on YYYY-MM-DD *labels*. A calendar date has one
 * weekday regardless of timezone, so these compute against a fixed noon-UTC
 * reference — no tz needed, no DST hazard (we never cross a real instant here).
 */

/** The date `n` days after `dateStr` (n may be negative). */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** The Sunday that begins the week containing `dateStr`. */
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -weekdayIndex(dateStr));
}

/** The seven date labels of the (Sunday-start) week containing `anchor`. */
export function weekDays(anchor: string): string[] {
  const sunday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}
