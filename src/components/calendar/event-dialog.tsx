"use client";

import { useMemo, useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import { CalendarEvent } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type CalendarActionResult,
} from "@/app/(app)/calendar/actions";
import { isoFromLocalInput, localInputValue } from "@/lib/calendar/format";
import { Dialog } from "./dialog";

/** What the parent asks the dialog to open as. */
export type EventDraft =
  | { mode: "create"; startISO: string; endISO: string }
  | { mode: "view"; event: CalendarEvent };

const eventKey = (e: CalendarEvent) => `${e.calendarId}::${e.id}`;

export function EventDialog({
  draft,
  tz,
  existingEvents,
  onClose,
  onCreated,
  onChanged,
}: {
  draft: EventDraft;
  tz: string;
  existingEvents: CalendarEvent[];
  onClose: () => void;
  onCreated: (result: Extract<CalendarActionResult, { ok: true }>) => void;
  onChanged: (message: string) => void;
}) {
  const isView = draft.mode === "view";
  const event = draft.mode === "view" ? draft.event : null;

  const [mode, setMode] = useState<"create" | "view" | "edit">(draft.mode);
  const [summary, setSummary] = useState(event?.summary ?? "");
  const [start, setStart] = useState(
    localInputValue(draft.mode === "create" ? draft.startISO : draft.event.start, tz),
  );
  const [end, setEnd] = useState(
    localInputValue(draft.mode === "create" ? draft.endISO : draft.event.end, tz),
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const editingKey = event ? eventKey(event) : null;

  // Free/busy at the point of decision: what does this time slot collide with?
  const conflicts = useMemo(() => {
    if (mode === "view") return [];
    const s = new Date(isoFromLocalInput(start, tz)).getTime();
    const e = new Date(isoFromLocalInput(end, tz)).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return [];
    return existingEvents
      .filter((ev) => !ev.allDay && eventKey(ev) !== editingKey)
      .filter((ev) => new Date(ev.start).getTime() < e && new Date(ev.end).getTime() > s)
      .slice(0, 4);
  }, [mode, start, end, tz, existingEvents, editingKey]);

  async function submit() {
    setBusy(true);
    setError("");
    const fields = {
      summary,
      startISO: isoFromLocalInput(start, tz),
      endISO: isoFromLocalInput(end, tz),
      location,
      description,
    };
    const result =
      mode === "create"
        ? await createCalendarEvent(fields)
        : await updateCalendarEvent(editingKey!, fields);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (mode === "create") onCreated(result);
    else onChanged(`Event updated: ${result.event.summary}`);
  }

  async function remove() {
    setBusy(true);
    setError("");
    const result = await deleteCalendarEvent(editingKey!);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged(`Event deleted: ${event!.summary}`);
  }

  const title = mode === "create" ? "New event" : mode === "edit" ? "Edit event" : event!.summary;

  return (
    <Dialog title={title} onClose={onClose}>
      {mode === "view" && event ? (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <p className="text-text-dim">
            {event.allDay
              ? "All day"
              : `${formatTime(event.start, tz)} – ${formatTime(event.end, tz)}`}
          </p>
          {event.location && (
            <p>
              <span className="text-text-dim">Location · </span>
              {event.location}
            </p>
          )}
          {!event.isPrimary && (
            <p className="text-text-dim">Calendar · {event.calendarSummary}</p>
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-dim">Delete this event?</span>
                <Button variant="danger" size="sm" loading={busy} onClick={remove}>
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            )}
            <Button size="sm" onClick={() => setMode("edit")}>
              Edit
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <Input
            label="Title"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            autoFocus
            placeholder="Event title"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Starts"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <Input
              label="Ends"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <Input
            label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Optional"
          />
          {mode === "create" && (
            <Textarea
              label="Notes"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          )}

          {conflicts.length > 0 && (
            <div className="rounded-control border border-accent/30 bg-accent-soft p-3 text-xs text-accent">
              <p className="font-medium">Overlaps {conflicts.length === 1 ? "an event" : `${conflicts.length} events`}:</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {conflicts.map((c) => (
                  <li key={eventKey(c)}>
                    {formatTime(c.start, tz)} · {c.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-bad">{error}</p>}

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (mode === "edit" ? setMode("view") : onClose())}
            >
              Cancel
            </Button>
            <Button size="sm" loading={busy} onClick={submit}>
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
