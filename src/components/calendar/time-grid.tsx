"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/utils";
import { CalendarEvent } from "@/lib/types";
import { layoutDay, resolveDayEvents } from "@/lib/calendar/layout";
import { minuteLabel } from "@/lib/calendar/format";

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const DAY_PX = 24 * HOUR_PX;
const MIN_EVENT_PX = 20;
const SNAP_MIN = 15;
const DEFAULT_SCROLL_MIN = 7 * 60; // 7am
const KEYBOARD_CREATE_MIN = 9 * 60; // Enter on a day opens a 9am draft

/** Current wall-clock minute, ticking each minute for the "now" line. */
function useNowMinute(tz: string): { dateStr: string; minute: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return { dateStr: `${p.year}-${p.month}-${p.day}`, minute: hour * 60 + Number(p.minute) };
}

function dayHeaderLabel(dateStr: string): { weekday: string; day: string } {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    day: d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" }),
  };
}

export function TimeGrid({
  days,
  events,
  tz,
  todayStr,
  focusedDayIndex,
  onFocusDay,
  onOpenEvent,
  onCreateSlot,
}: {
  days: string[];
  events: CalendarEvent[];
  tz: string;
  todayStr: string;
  focusedDayIndex: number;
  onFocusDay: (index: number) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onCreateSlot: (dateStr: string, minute: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const now = useNowMinute(tz);

  // Per-day: all-day chips and packed timed boxes.
  const perDay = useMemo(
    () =>
      days.map((day) => {
        const allDay = events.filter(
          (e) => e.allDay && day >= (e.start ?? "") && day < (e.end ?? ""),
        );
        const timed = layoutDay(resolveDayEvents(events, day, tz), { minDurationMin: SNAP_MIN });
        return { day, allDay, timed };
      }),
    [days, events, tz],
  );

  const hasAllDay = perDay.some((d) => d.allDay.length > 0);

  // Scroll to a sensible default: an hour before the first event, else 7am.
  useEffect(() => {
    const firstStart = Math.min(
      ...perDay.flatMap((d) => d.timed.map((b) => b.startMin)),
      DEFAULT_SCROLL_MIN,
    );
    const target = Math.max(0, firstStart - 60);
    if (scrollRef.current) scrollRef.current.scrollTop = target * PX_PER_MIN;
    // Re-run only when the set of days changes (navigation), not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  function onHeaderKeyDown(e: React.KeyboardEvent, index: number, day: string) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = (index + delta + days.length) % days.length;
      onFocusDay(next);
      headerRefs.current[next]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCreateSlot(day, KEYBOARD_CREATE_MIN);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-card border bg-surface">
      {/* Day headers */}
      <div className="flex border-b">
        <div className="w-14 shrink-0" />
        <div className="flex flex-1">
          {days.map((day, i) => {
            const { weekday, day: dayNum } = dayHeaderLabel(day);
            const isToday = day === todayStr;
            return (
              <button
                key={day}
                ref={(el) => {
                  headerRefs.current[i] = el;
                }}
                tabIndex={i === focusedDayIndex ? 0 : -1}
                onFocus={() => onFocusDay(i)}
                onKeyDown={(e) => onHeaderKeyDown(e, i, day)}
                onClick={() => onCreateSlot(day, KEYBOARD_CREATE_MIN)}
                aria-label={`${new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                })} — new event`}
                className={cn(
                  "transition-fast flex flex-1 flex-col items-center gap-0.5 border-l py-2 text-center first:border-l-0 hover:bg-surface-2",
                  isToday && "bg-accent-soft/50",
                )}
              >
                <span className="text-[11px] uppercase tracking-wide text-text-dim">{weekday}</span>
                <span
                  className={cn(
                    "tabular text-sm font-semibold",
                    isToday && "flex h-6 w-6 items-center justify-center rounded-pill bg-accent text-white",
                  )}
                >
                  {dayNum}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div className="flex border-b bg-surface-2/40">
          <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-[10px] uppercase tracking-wide text-text-dim">
            All day
          </div>
          <div className="flex flex-1">
            {perDay.map(({ day, allDay }) => (
              <div key={day} className="flex flex-1 flex-col gap-1 border-l p-1 first:border-l-0">
                {allDay.map((e) => (
                  <button
                    key={`${e.calendarId}:${e.id}`}
                    onClick={() => onOpenEvent(e)}
                    className="truncate rounded-control bg-accent-soft px-1.5 py-0.5 text-left text-[11px] text-accent hover:opacity-90"
                  >
                    {e.summary}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="max-h-[62vh] overflow-y-auto">
        <div className="flex">
          {/* Hour gutter */}
          <div className="relative w-14 shrink-0" style={{ height: DAY_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="tabular absolute right-2 -translate-y-1/2 text-[11px] text-text-dim"
                style={{ top: h * HOUR_PX }}
              >
                {h === 0 ? "" : minuteLabel(h * 60)}
              </span>
            ))}
          </div>

          {/* Day columns */}
          <div className="relative flex-1" style={{ height: DAY_PX }}>
            {/* Hour lines */}
            {Array.from({ length: 25 }, (_, h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-border/50"
                style={{ top: h * HOUR_PX }}
              />
            ))}

            <div className="absolute inset-0 flex">
              {perDay.map(({ day, timed }) => {
                const isToday = day === todayStr;
                return (
                  <div
                    key={day}
                    className="relative flex-1 border-l border-border/40 first:border-l-0"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const rawMin = (e.clientY - rect.top) / PX_PER_MIN;
                      const minute = Math.min(
                        1440 - SNAP_MIN,
                        Math.max(0, Math.round(rawMin / SNAP_MIN) * SNAP_MIN),
                      );
                      onCreateSlot(day, minute);
                    }}
                  >
                    {timed.map((box) => {
                      const top = box.startMin * PX_PER_MIN;
                      const height = Math.max(MIN_EVENT_PX, (box.endMin - box.startMin) * PX_PER_MIN);
                      const primary = box.event.isPrimary;
                      return (
                        <button
                          key={`${box.event.calendarId}:${box.event.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenEvent(box.event);
                          }}
                          style={{
                            top,
                            height,
                            left: `calc(${box.left * 100}% + 2px)`,
                            width: `calc(${box.width * 100}% - 4px)`,
                          }}
                          className={cn(
                            "transition-fast absolute overflow-hidden rounded-control border px-1.5 py-0.5 text-left leading-tight hover:border-accent",
                            primary
                              ? "border-accent/30 bg-accent-soft text-accent"
                              : "border-border bg-surface-2 text-text",
                          )}
                        >
                          <span className="block truncate text-[11px] font-medium">
                            {box.event.summary}
                          </span>
                          {height >= 32 && (
                            <span className="tabular block truncate text-[10px] opacity-80">
                              {formatTime(box.event.start, tz)}
                              {box.event.location ? ` · ${box.event.location}` : ""}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {/* Now line */}
                    {isToday && now.dateStr === day && (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                        style={{ top: now.minute * PX_PER_MIN }}
                        aria-hidden
                      >
                        <span className="-ml-1 h-2 w-2 rounded-pill bg-accent" />
                        <span className="h-px flex-1 bg-accent" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
