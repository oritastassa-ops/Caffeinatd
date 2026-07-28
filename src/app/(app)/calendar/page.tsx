import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { getAccessToken } from "@/lib/google/oauth";
import { listEvents } from "@/lib/google/calendar";
import { localDateStr } from "@/lib/utils";
import { CalendarEvent } from "@/lib/types";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { dayWindow } from "@/lib/calendar/layout";
import { weekDays } from "@/lib/calendar/dates";
import { CalendarView } from "@/components/calendar/calendar-view";

export const dynamic = "force-dynamic";

/** YYYY-MM-DD or nothing → validated anchor date. */
function parseAnchor(raw: string | undefined, fallback: string): string {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const tz = profile.timezone;
  const todayStr = localDateStr(tz);

  const accessToken = await getAccessToken(supabase, user.id);
  if (!accessToken) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Calendar" />
        <Card className="flex flex-col items-center gap-3 text-center">
          <EmptyState hint="Connect Google Calendar to see your week, create events, and get scheduling help from ⌘K." />
          <LinkButton href="/api/google/auth">Connect Google Calendar</LinkButton>
        </Card>
      </div>
    );
  }

  const { date } = await searchParams;
  const anchorDate = parseAnchor(date, todayStr);
  const week = weekDays(anchorDate);
  const rangeStart = new Date(dayWindow(week[0] ?? anchorDate, tz).startMs).toISOString();
  const rangeEnd = new Date(dayWindow(week[6] ?? anchorDate, tz).endMs).toISOString();

  let events: CalendarEvent[] = [];
  let error: string | undefined;
  try {
    events = await listEvents(accessToken, rangeStart, rangeEnd, user.id);
  } catch {
    error = "Couldn’t reach Google Calendar. Your events may be out of date — reconnect in Settings if this persists.";
  }

  return (
    <CalendarView
      events={events}
      tz={tz}
      todayStr={todayStr}
      anchorDate={anchorDate}
      error={error}
    />
  );
}
