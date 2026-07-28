/**
 * Pure calendar layout math — no React, no date-strings-as-positions.
 *
 * Split in two so the tz-sensitive part and the geometry part are testable in
 * isolation:
 *   resolveDayEvents  ISO times + timezone  → minutes-from-midnight, clipped
 *   layoutDay         minute intervals       → column-packed boxes (fractions)
 *
 * Vertical position is minutes; horizontal position is fractions in [0, 1] of
 * the day column. The React layer multiplies minutes by px-per-minute and
 * fractions by the column width. Keeping this unitless is what makes overlap,
 * midnight-crossing and DST testable without a DOM.
 */

import { zonedTimeToUtc } from "@/lib/utils";
import { addDays } from "./dates";

const MS_PER_MIN = 60_000;
export const MINUTES_PER_DAY = 1440;

/** Wall-clock minutes-from-midnight (hour*60 + minute) of an instant, read in
 *  the given timezone. */
function localMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  return hour * 60 + Number(map.minute);
}

export interface DayWindow {
  /** UTC epoch ms of local midnight starting the day. */
  startMs: number;
  /** UTC epoch ms of the *next* local midnight (exclusive end). */
  endMs: number;
  /** Length in minutes — 1440 normally, 1380 on spring-forward, 1500 on
   *  fall-back. Never hardcode 1440; DST days are real. */
  lengthMin: number;
}

/**
 * The [midnight, next-midnight) window for a local day, as UTC instants. Uses
 * the *true* next midnight (not 23:59) so the length reflects DST: a
 * spring-forward day is 23h, a fall-back day is 25h.
 */
export function dayWindow(dateStr: string, tz: string): DayWindow {
  const startMs = zonedTimeToUtc(dateStr, "00:00", tz).getTime();
  const endMs = zonedTimeToUtc(addDays(dateStr, 1), "00:00", tz).getTime();
  return { startMs, endMs, lengthMin: Math.round((endMs - startMs) / MS_PER_MIN) };
}

export interface TimedEvent {
  start: string; // ISO datetime (or date, for all-day)
  end: string;
  allDay: boolean;
}

export interface ResolvedEvent<T> {
  event: T;
  /** Wall-clock minutes from midnight (0–1440) in the user's timezone. */
  startMin: number;
  endMin: number;
}

/**
 * Resolve timed events onto one local day as wall-clock minute intervals in the
 * user's timezone, clipped to [0, 1440]. Positioning is by wall-clock — a 9am
 * meeting lands at the "9am" gridline — so the axis labels always align, which
 * is what makes a 23h/25h DST day render sensibly on a uniform grid (the
 * skipped hour is simply empty; a repeated hour shows both instances).
 *
 * All-day events are excluded (they don't belong on the time axis). An event
 * crossing midnight is clipped to this day; call once per day it touches and it
 * appears in each, correctly bounded.
 */
export function resolveDayEvents<T extends TimedEvent>(
  events: T[],
  dateStr: string,
  tz: string,
): ResolvedEvent<T>[] {
  const { startMs, endMs } = dayWindow(dateStr, tz);
  const resolved: ResolvedEvent<T>[] = [];

  for (const event of events) {
    if (event.allDay) continue;
    const s = new Date(event.start).getTime();
    const e = new Date(event.end).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    // No intersection with this day.
    if (e <= startMs || s >= endMs) continue;
    const clippedStart = Math.max(s, startMs);
    const clippedEnd = Math.min(e, endMs);
    const startMin = clippedStart <= startMs ? 0 : localMinutes(clippedStart, tz);
    // A clip to the next midnight reads as 00:00 locally; treat it as end-of-day.
    let endMin = clippedEnd >= endMs ? MINUTES_PER_DAY : localMinutes(clippedEnd, tz);
    if (endMin <= startMin) endMin = MINUTES_PER_DAY;
    resolved.push({ event, startMin, endMin });
  }
  return resolved;
}

export interface PositionedEvent<T> extends ResolvedEvent<T> {
  /** Left edge as a fraction of the day column, in [0, 1). */
  left: number;
  /** Width as a fraction of the day column, in (0, 1]. */
  width: number;
  /** Total columns in this event's overlap cluster (for debugging/aria). */
  columns: number;
  /** This event's column index within the cluster. */
  column: number;
}

export interface LayoutOptions {
  /**
   * Minimum footprint in minutes. A zero-duration or 5-minute event is inflated
   * to at least this so it stays clickable — and, because the same inflated
   * interval drives overlap, two coincident zero-length events sit side by side
   * instead of stacking invisibly.
   */
  minDurationMin?: number;
}

/**
 * Column-pack overlapping events (the Google Calendar approach):
 *
 *  1. Inflate each event to `minDurationMin`, then sort by start asc, end desc.
 *  2. Sweep into clusters — maximal transitively-overlapping runs. A new event
 *     whose start is >= the running cluster end opens a fresh cluster.
 *  3. Within a cluster, first-fit column assignment (sorted by start, this is
 *     optimal for interval graphs): place each event in the first column whose
 *     last event has ended, else open a new column.
 *  4. width = 1 / columns, left = column / columns.
 *
 * Consequence worth knowing: in a chain A–B–C where A and C don't overlap but
 * both overlap B, the cluster is 2 columns wide, so A and C share a column and
 * render at half width. That's correct, standard behavior — not a bug.
 */
export function layoutDay<T>(
  resolved: ResolvedEvent<T>[],
  opts: LayoutOptions = {},
): PositionedEvent<T>[] {
  const minDur = opts.minDurationMin ?? 0;

  const items = resolved
    .map((r) => ({ ...r, endMin: Math.max(r.endMin, r.startMin + minDur) }))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: PositionedEvent<T>[] = [];
  let cluster: ResolvedEvent<T>[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    // Each entry is a column's current end-minute; first-fit reuse.
    const columnEnds: number[] = [];
    const placed = cluster.map((ev) => {
      let col = columnEnds.findIndex((end) => end <= ev.startMin);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(ev.endMin);
      } else {
        columnEnds[col] = ev.endMin;
      }
      return { ev, col };
    });
    const columns = columnEnds.length;
    for (const { ev, col } of placed) {
      out.push({ ...ev, columns, column: col, width: 1 / columns, left: col / columns });
    }
    cluster = [];
  };

  for (const ev of items) {
    if (cluster.length > 0 && ev.startMin >= clusterEnd) flush();
    clusterEnd = cluster.length === 0 ? ev.endMin : Math.max(clusterEnd, ev.endMin);
    cluster.push(ev);
  }
  if (cluster.length > 0) flush();

  // Restore input order isn't needed; callers key by event id.
  return out;
}
