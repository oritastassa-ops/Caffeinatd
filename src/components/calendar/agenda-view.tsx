"use client";

import { EmptyState } from "@/components/ui";
import { CalendarEvent } from "@/lib/types";
import { formatTime, localDateStr } from "@/lib/utils";
import { cn } from "@/lib/utils";

function dayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return "Today";
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The list view — the right answer on a phone and for a sparse week, not a
 * fallback. Events grouped by their start day; empty days are omitted, but if
 * the whole range is empty we say something useful.
 */
export function AgendaView({
  days,
  events,
  tz,
  todayStr,
  onOpenEvent,
}: {
  days: string[];
  events: CalendarEvent[];
  tz: string;
  todayStr: string;
  onOpenEvent: (event: CalendarEvent) => void;
}) {
  const grouped = days
    .map((day) => {
      const dayEvents = events
        .filter((e) =>
          e.allDay ? day >= (e.start ?? "") && day < (e.end ?? "") : localDateStr(tz, new Date(e.start)) === day,
        )
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
      return { day, dayEvents };
    })
    .filter((g) => g.dayEvents.length > 0);

  if (grouped.length === 0) {
    return (
      <div className="rounded-card border bg-surface p-2">
        <EmptyState
          title="Nothing scheduled this week"
          hint='A clear week. Press ⌘K to add something — "lunch with Sam Friday at noon".'
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {grouped.map(({ day, dayEvents }) => (
        <section key={day} className="flex flex-col gap-1.5">
          <h2
            className={cn(
              "text-xs font-semibold uppercase tracking-wider",
              day === todayStr ? "text-accent" : "text-text-dim",
            )}
          >
            {dayLabel(day, todayStr)}
          </h2>
          <ul className="flex flex-col overflow-hidden rounded-card border bg-surface">
            {dayEvents.map((e) => (
              <li key={`${e.calendarId}:${e.id}`}>
                <button
                  onClick={() => onOpenEvent(e)}
                  className="transition-fast flex w-full items-baseline gap-3 border-b px-4 py-2.5 text-left last:border-b-0 hover:bg-surface-2"
                >
                  <span className="tabular w-28 shrink-0 text-xs text-text-dim">
                    {e.allDay ? "All day" : `${formatTime(e.start, tz)} – ${formatTime(e.end, tz)}`}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="truncate">{e.summary}</span>
                    {e.location && <span className="text-text-dim"> · {e.location}</span>}
                    {!e.isPrimary && <span className="text-text-dim"> · {e.calendarSummary}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
