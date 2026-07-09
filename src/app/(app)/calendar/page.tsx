import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { getAccessToken } from "@/lib/google/oauth";
import { listEvents } from "@/lib/google/calendar";
import { endOfDayISO, formatTime, localDateStr, startOfDayISO } from "@/lib/utils";
import { CalendarEvent } from "@/lib/types";
import { Card, CardTitle, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const tz = profile.timezone;

  const accessToken = await getAccessToken(supabase, user.id);
  if (!accessToken) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <Card>
          <EmptyState hint="Google Calendar isn't connected yet." />
          <div className="text-center">
            <Link
              href="/api/google/auth"
              className="transition-fast inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Connect Google Calendar
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const today = localDateStr(tz);
  const weekEnd = localDateStr(tz, new Date(Date.now() + 6 * 86400_000));
  let events: CalendarEvent[] = [];
  let failed = false;
  try {
    events = await listEvents(accessToken, startOfDayISO(today, tz), endOfDayISO(weekEnd, tz), user.id);
  } catch {
    failed = true;
  }

  // Group by local day
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const day = e.allDay ? e.start : localDateStr(tz, new Date(e.start));
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const days = [...Array(7)].map((_, i) => localDateStr(tz, new Date(Date.now() + i * 86400_000)));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">This week</h1>
      {failed && (
        <p className="rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
          Couldn’t reach Google Calendar — try{" "}
          <Link href="/api/google/auth" className="underline">
            reconnecting
          </Link>
          .
        </p>
      )}
      {days.map((day) => {
        const dayEvents = byDay.get(day) ?? [];
        const label = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
        return (
          <Card key={day} className={day === today ? "border-accent/40" : ""}>
            <CardTitle>
              {day === today ? "Today" : label}
            </CardTitle>
            {dayEvents.length === 0 ? (
              <p className="text-sm text-text-dim">Free.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {dayEvents.map((e) => (
                  <li key={`${e.calendarId}:${e.id}`} className="flex gap-3 text-sm">
                    <span className="tabular w-28 shrink-0 text-text-dim">
                      {e.allDay ? "All day" : `${formatTime(e.start, tz)}–${formatTime(e.end, tz)}`}
                    </span>
                    <span>
                      {e.summary}
                      {e.location && <span className="text-text-dim"> · {e.location}</span>}
                      {!e.isPrimary && <span className="text-text-dim"> · {e.calendarSummary}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      <p className="text-center text-xs text-text-dim">
        Schedule with ⌘K — “schedule dentist Thursday at 3”
      </p>
    </div>
  );
}
