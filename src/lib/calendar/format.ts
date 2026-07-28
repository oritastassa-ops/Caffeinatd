import { zonedTimeToUtc } from "@/lib/utils";

/**
 * Timezone-aware conversions between the calendar's numeric model and the
 * strings the UI needs — all anchored to the *user's* timezone, never the
 * browser's. Kept out of components so the tz reasoning lives in one place.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO instant for a wall-clock minute-of-day on a given local date. */
export function isoFromDayMinute(dateStr: string, minute: number, tz: string): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return zonedTimeToUtc(dateStr, `${pad2(h)}:${pad2(m)}`, tz).toISOString();
}

/** "9 AM", "9:30 AM" — for the hour gutter and event times. */
export function minuteLabel(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${pad2(m)} ${period}`;
}

/** Value for a <input type="datetime-local"> showing an instant in the user's
 *  timezone: "YYYY-MM-DDTHH:mm". */
export function localInputValue(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}

/** Inverse of localInputValue: a datetime-local string (wall time in the user's
 *  tz) back to a UTC ISO instant. */
export function isoFromLocalInput(value: string, tz: string): string {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return new Date(value).toISOString();
  return zonedTimeToUtc(datePart, timePart, tz).toISOString();
}
