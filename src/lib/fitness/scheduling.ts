import { CalendarEvent } from "@/lib/types";

export interface FreeSlot {
  start: string; // "HH:MM" local
  end: string;
}

/**
 * First gap of at least `durationMin` between `dayStartHour` and
 * `dayEndHour` local time, given a day's timed events. Pure — the caller
 * resolves "today"/"Saturday" and timezone before calling this.
 */
export function findFreeSlot(
  events: CalendarEvent[],
  durationMin: number,
  dayStartHour = 7,
  dayEndHour = 21,
): FreeSlot | null {
  const timed = events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: new Date(e.start), end: new Date(e.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const dayStart = new Date(timed[0]?.start ?? new Date());
  dayStart.setHours(dayStartHour, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(dayEndHour, 0, 0, 0);

  let cursor = dayStart;
  for (const ev of timed) {
    if (ev.start.getTime() - cursor.getTime() >= durationMin * 60_000) {
      return { start: toHHMM(cursor), end: toHHMM(new Date(cursor.getTime() + durationMin * 60_000)) };
    }
    if (ev.end.getTime() > cursor.getTime()) cursor = ev.end;
  }
  if (dayEnd.getTime() - cursor.getTime() >= durationMin * 60_000) {
    return { start: toHHMM(cursor), end: toHHMM(new Date(cursor.getTime() + durationMin * 60_000)) };
  }
  return null;
}

function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
