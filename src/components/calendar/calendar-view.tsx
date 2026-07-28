"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, SegmentedControl } from "@/components/ui";
import { CalendarEvent } from "@/lib/types";
import { addDays, weekDays } from "@/lib/calendar/dates";
import { isoFromDayMinute } from "@/lib/calendar/format";
import { TimeGrid } from "./time-grid";
import { AgendaView } from "./agenda-view";
import { EventDialog, type EventDraft } from "./event-dialog";
import { ActionToast, type ToastState } from "./action-toast";

type View = "day" | "week" | "agenda";
const VIEW_KEY = "caffeinatd.calendarView";
const HOUR_MS = 3_600_000;

function rangeLabel(days: string[]): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  if (days.length === 1) return fmt(first, { weekday: "long", month: "long", day: "numeric" });
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${fmt(first, { month: "short", day: "numeric" })} – ${fmt(
    last,
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  )}`;
}

export function CalendarView({
  events,
  tz,
  todayStr,
  anchorDate,
  error,
}: {
  events: CalendarEvent[];
  tz: string;
  todayStr: string;
  anchorDate: string;
  error?: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("week");
  const [isMobile, setIsMobile] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const week = weekDays(anchorDate);
  const [focusedDayIndex, setFocusedDayIndex] = useState(() => {
    const i = week.indexOf(todayStr);
    return i === -1 ? 0 : i;
  });

  // Restore the saved view; clamp to Agenda on phones, where a 7-column grid is
  // unusable. matchMedia (not just CSS) so the grid is never even rendered.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    const saved = window.localStorage.getItem(VIEW_KEY) as View | null;
    if (saved === "day" || saved === "week" || saved === "agenda") setView(saved);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const effectiveView: View = isMobile ? "agenda" : view;
  const days = effectiveView === "day" ? [anchorDate] : week;

  function chooseView(next: View) {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  function goTo(dateStr: string) {
    router.push(`/calendar?date=${dateStr}`);
  }

  function step(direction: 1 | -1) {
    const span = effectiveView === "day" ? 1 : 7;
    goTo(addDays(anchorDate, direction * span));
  }

  function openCreate(dateStr: string, minute: number) {
    const startISO = isoFromDayMinute(dateStr, minute, tz);
    const endISO = new Date(new Date(startISO).getTime() + HOUR_MS).toISOString();
    setDraft({ mode: "create", startISO, endISO });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Calendar"
        action={
          <Button size="sm" onClick={() => openCreate(anchorDate, 9 * 60)}>
            New event
          </Button>
        }
      />

      {error && (
        <p className="rounded-card border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Previous" onClick={() => step(-1)}>
            ‹
          </Button>
          <Button variant="secondary" size="sm" onClick={() => goTo(todayStr)}>
            Today
          </Button>
          <Button variant="ghost" size="sm" aria-label="Next" onClick={() => step(1)}>
            ›
          </Button>
          <span className="ml-2 text-sm font-medium">{rangeLabel(days)}</span>
        </div>

        {!isMobile && (
          <SegmentedControl<View>
            ariaLabel="Calendar view"
            size="sm"
            value={view}
            onChange={chooseView}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "agenda", label: "Agenda" },
            ]}
          />
        )}
      </div>

      {effectiveView === "agenda" ? (
        <AgendaView
          days={week}
          events={events}
          tz={tz}
          todayStr={todayStr}
          onOpenEvent={(event) => setDraft({ mode: "view", event })}
        />
      ) : (
        <TimeGrid
          days={days}
          events={events}
          tz={tz}
          todayStr={todayStr}
          focusedDayIndex={Math.min(focusedDayIndex, days.length - 1)}
          onFocusDay={setFocusedDayIndex}
          onOpenEvent={(event) => setDraft({ mode: "view", event })}
          onCreateSlot={openCreate}
        />
      )}

      <p className="text-center text-xs text-text-dim">
        Or schedule with ⌘K — “schedule dentist Thursday at 3”.
      </p>

      {draft && (
        <EventDialog
          draft={draft}
          tz={tz}
          existingEvents={events}
          onClose={() => setDraft(null)}
          onCreated={(result) => {
            setDraft(null);
            setToast({ label: `Event created: ${result.event.summary}`, undo: result.undo });
            router.refresh();
          }}
          onChanged={(message) => {
            setDraft(null);
            setToast({ label: message });
            router.refresh();
          }}
        />
      )}

      {toast && (
        <ActionToast
          toast={toast}
          onDismiss={() => setToast(null)}
          onUndone={() => {
            setToast(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
