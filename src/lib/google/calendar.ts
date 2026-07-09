import { CalendarEvent } from "@/lib/types";

const API = "https://www.googleapis.com/calendar/v3";

interface GoogleEvent {
  id: string;
  summary?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  status?: string;
}

function toEvent(cal: CalendarListEntry, e: GoogleEvent): CalendarEvent {
  const allDay = !e.start.dateTime;
  return {
    id: e.id,
    calendarId: cal.id,
    calendarSummary: cal.summary,
    isPrimary: cal.primary,
    summary: e.summary ?? "(untitled)",
    start: e.start.dateTime ?? e.start.date ?? "",
    end: e.end.dateTime ?? e.end.date ?? "",
    location: e.location,
    allDay,
  };
}

/** Composite key used in tool-facing event ids: "<calendarId>::<eventId>". */
export function encodeEventKey(calendarId: string, eventId: string): string {
  return `${calendarId}::${eventId}`;
}

export function decodeEventKey(key: string): { calendarId: string; eventId: string } {
  const idx = key.indexOf("::");
  if (idx === -1) return { calendarId: "primary", eventId: key }; // defensive fallback
  return { calendarId: key.slice(0, idx), eventId: key.slice(idx + 2) };
}

async function gfetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
  return res;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
}

const calendarListCache = new Map<string, { at: number; calendars: CalendarListEntry[] }>();
const CALENDAR_LIST_CACHE_MS = 5 * 60_000; // the set of calendars a user has changes rarely

/** Every calendar the user can see — not just primary. */
export async function listCalendars(accessToken: string, cacheKey?: string): Promise<CalendarListEntry[]> {
  if (cacheKey) {
    const hit = calendarListCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CALENDAR_LIST_CACHE_MS) return hit.calendars;
  }
  const res = await gfetch(accessToken, `/users/me/calendarList?minAccessRole=reader`);
  const data = (await res.json()) as {
    items?: { id: string; summary?: string; primary?: boolean; hidden?: boolean; deleted?: boolean }[];
  };
  const calendars = (data.items ?? [])
    .filter((c) => !c.hidden && !c.deleted)
    .map((c) => ({ id: c.id, summary: c.summary ?? c.id, primary: Boolean(c.primary) }));
  if (cacheKey) calendarListCache.set(cacheKey, { at: Date.now(), calendars });
  return calendars;
}

// Short per-user agenda cache — just enough to absorb duplicate requests in
// the same page render, not so long that "I just added an event" looks
// broken. Module scope is fine on serverless: a cold instance just misses.
const AGENDA_CACHE_MS = 10_000;
const agendaCache = new Map<string, { at: number; events: CalendarEvent[] }>();

/** Events across every calendar the user has, merged and time-sorted. */
export async function listEvents(
  accessToken: string,
  timeMinISO: string,
  timeMaxISO: string,
  cacheKey?: string,
): Promise<CalendarEvent[]> {
  const key = cacheKey ? `${cacheKey}:${timeMinISO}:${timeMaxISO}` : null;
  if (key) {
    const hit = agendaCache.get(key);
    if (hit && Date.now() - hit.at < AGENDA_CACHE_MS) return hit.events;
  }

  const calendars = await listCalendars(accessToken, cacheKey);
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      try {
        const res = await gfetch(accessToken, `/calendars/${encodeURIComponent(cal.id)}/events?${params}`);
        const data = (await res.json()) as { items?: GoogleEvent[] };
        return (data.items ?? [])
          .filter((e) => e.status !== "cancelled")
          .map((e) => toEvent(cal, e));
      } catch {
        return []; // one inaccessible calendar shouldn't blank the whole agenda
      }
    }),
  );

  const events = perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start));
  if (key) agendaCache.set(key, { at: Date.now(), events });
  return events;
}

export interface EventInput {
  summary: string;
  startISO: string;
  endISO: string;
  location?: string;
  description?: string;
  recurrence?: string; // RRULE
}

/** New events always go to the primary calendar — a sensible default. */
export async function createEvent(accessToken: string, input: EventInput): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    location: input.location,
    description: input.description,
    start: { dateTime: input.startISO },
    end: { dateTime: input.endISO },
  };
  if (input.recurrence) body.recurrence = [`RRULE:${input.recurrence}`];
  const res = await gfetch(accessToken, `/calendars/primary/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  agendaCache.clear();
  return toEvent({ id: "primary", summary: "primary", primary: true }, await res.json());
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Partial<EventInput>,
): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {};
  if (patch.summary) body.summary = patch.summary;
  if (patch.location) body.location = patch.location;
  if (patch.startISO) body.start = { dateTime: patch.startISO };
  if (patch.endISO) body.end = { dateTime: patch.endISO };
  const res = await gfetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  agendaCache.clear();
  return toEvent({ id: calendarId, summary: calendarId, primary: calendarId === "primary" }, await res.json());
}

export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  await gfetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: "DELETE",
  });
  agendaCache.clear();
}

/** Busy intervals across every calendar, overlapping [timeMin, timeMax]. */
export async function getBusy(
  accessToken: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<{ start: string; end: string }[]> {
  const calendars = await listCalendars(accessToken);
  const res = await gfetch(accessToken, `/freeBusy`, {
    method: "POST",
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: calendars.map((c) => ({ id: c.id })),
    }),
  });
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  return Object.values(data.calendars ?? {}).flatMap((c) => c.busy ?? []);
}

export function findConflicts(
  busy: { start: string; end: string }[],
  startISO: string,
  endISO: string,
): { start: string; end: string }[] {
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  return busy.filter((b) => new Date(b.start).getTime() < e && new Date(b.end).getTime() > s);
}
