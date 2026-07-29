import { CalendarEvent } from "@/lib/types";

/**
 * Deterministic time-block placement — the scheduling math shared by the morning
 * daily plan (daily.ts) and the conversational replan_today tool. Per the
 * repo's core rule (CLAUDE.md, "deterministic math, LLM phrasing"), the model
 * NEVER positions blocks: it supplies the items and their words, this code lays
 * them into the real free gaps. Everything here is pure and works in local
 * minutes-from-midnight, so it is trivially unit-testable; the one timezone-
 * sensitive step (reading an event's local time, and later converting a placed
 * block back to UTC) is isolated to `localMinutes` here and `zonedTimeToUtc` at
 * the call site, which is where DST is handled.
 */

/** A half-open interval in minutes from local midnight: [start, end). */
export interface Interval {
  start: number;
  end: number;
}

export interface PlaceItem {
  title: string;
  durationMin: number;
}

export interface Block {
  start: number; // minutes from local midnight
  end: number;
  title: string;
}

const DAY_MIN = 24 * 60;

export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minToHHMM(min: number): string {
  const clamped = Math.max(0, Math.min(DAY_MIN, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** An event's local wall-clock minute on its own day (DST-correct via Intl). */
function localMinutes(iso: string, tz: string): number {
  const hhmm = new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return hhmmToMin(hhmm);
}

/**
 * Timed events on `date` → sorted, merged busy intervals in local minutes.
 * All-day events don't block time slots and are ignored. Events are clamped to
 * the day; an event that starts before or ends after `date` contributes only its
 * overlap with the day (a multi-day event blocks the whole day).
 */
export function busyIntervals(events: CalendarEvent[], tz: string, date: string): Interval[] {
  const raw: Interval[] = [];
  for (const e of events) {
    if (e.allDay) continue;
    const startDay = e.start.slice(0, 10) <= date;
    const endDay = e.end.slice(0, 10) >= date;
    if (!startDay && !endDay) continue;
    // A block starting on an earlier day is busy from midnight; one ending on a
    // later day is busy until midnight.
    const start = e.start.slice(0, 10) < date ? 0 : localMinutes(e.start, tz);
    const end = e.end.slice(0, 10) > date ? DAY_MIN : localMinutes(e.end, tz);
    if (end > start) raw.push({ start, end });
  }
  return mergeIntervals(raw);
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * The free gaps within [dayStart, dayEnd), around the busy intervals, no shorter
 * than `minLen`. `after` clips the earliest usable minute — pass the current
 * local time so a mid-day re-plan never places anything in the past.
 */
export function freeWindows(
  busy: Interval[],
  dayStart: number,
  dayEnd: number,
  after = dayStart,
  minLen = 15,
): Interval[] {
  const windows: Interval[] = [];
  let cursor = Math.max(dayStart, after);
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) {
      const end = Math.min(b.start, dayEnd);
      if (end - cursor >= minLen) windows.push({ start: cursor, end });
    }
    cursor = Math.max(cursor, b.end);
    if (cursor >= dayEnd) break;
  }
  if (dayEnd - cursor >= minLen) windows.push({ start: cursor, end: dayEnd });
  return windows;
}

/**
 * Lay `items` into `windows` in order, back-to-back with an optional gap, never
 * overlapping a window's edge (and therefore never a real event). Returns the
 * blocks that fit; items that don't fit are simply not placed — the caller
 * reports how many landed. Order is preserved so callers can pass items in
 * priority order.
 */
export function placeBlocks(windows: Interval[], items: PlaceItem[], gapMin = 0): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  for (const window of windows) {
    let cursor = window.start;
    while (i < items.length) {
      const item = items[i]!;
      if (cursor + item.durationMin > window.end) break; // doesn't fit this window
      blocks.push({ start: cursor, end: cursor + item.durationMin, title: item.title });
      cursor += item.durationMin + gapMin;
      i += 1;
    }
    if (i >= items.length) break;
  }
  return blocks;
}
