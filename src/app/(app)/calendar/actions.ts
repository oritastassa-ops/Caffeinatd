"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import { createEvent, updateEvent, deleteEvent, decodeEventKey } from "@/lib/google/calendar";
import { CalendarEvent } from "@/lib/types";

/**
 * Calendar mutations, driven from the grid rather than the assistant. Every one
 * returns a discriminated result: the caller shows a ✓ (and, for create, an
 * Undo) only when `ok` is true and the write actually reached Google. There is
 * no optimistic success — a failed PATCH never renders as saved. This mirrors
 * the executor's receipt path (src/lib/pipeline/executor.ts) so the trust model
 * is identical whether a write comes from ⌘K or a click.
 */
export type CalendarActionResult =
  | { ok: true; event: CalendarEvent; undo: { calendarId: string; calendarEventId: string } }
  | { ok: false; error: string };

export type SimpleResult = { ok: true } | { ok: false; error: string };

interface EventFields {
  summary: string;
  startISO: string;
  endISO: string;
  location?: string;
  description?: string;
}

/** Shared validation for create/edit. Returns an error sentence or null. */
function validate(fields: EventFields): string | null {
  if (!fields.summary.trim()) return "Give the event a title.";
  const start = new Date(fields.startISO).getTime();
  const end = new Date(fields.endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "That start or end time isn't valid.";
  if (end <= start) return "The end time has to be after the start time.";
  return null;
}

async function tokenOrError(): Promise<
  { token: string } | { error: string }
> {
  const { supabase, user } = await requireUser();
  const token = await getAccessToken(supabase, user.id);
  if (!token) return { error: "Google Calendar isn't connected. Connect it in Settings." };
  return { token };
}

export async function createCalendarEvent(fields: EventFields): Promise<CalendarActionResult> {
  const invalid = validate(fields);
  if (invalid) return { ok: false, error: invalid };

  const auth = await tokenOrError();
  if ("error" in auth) return { ok: false, error: auth.error };

  try {
    const event = await createEvent(auth.token, {
      summary: fields.summary.trim(),
      startISO: fields.startISO,
      endISO: fields.endISO,
      location: fields.location?.trim() || undefined,
      description: fields.description?.trim() || undefined,
    });
    revalidatePath("/calendar");
    // New events always land on primary; undo deletes exactly that event.
    return { ok: true, event, undo: { calendarId: "primary", calendarEventId: event.id } };
  } catch (err) {
    console.error("[calendar] create_event failed:", err);
    return { ok: false, error: "Couldn't create the event on Google Calendar. Try again." };
  }
}

export async function updateCalendarEvent(
  eventKey: string,
  fields: EventFields,
): Promise<CalendarActionResult> {
  const invalid = validate(fields);
  if (invalid) return { ok: false, error: invalid };

  const auth = await tokenOrError();
  if ("error" in auth) return { ok: false, error: auth.error };

  const { calendarId, eventId } = decodeEventKey(eventKey);
  try {
    const event = await updateEvent(auth.token, calendarId, eventId, {
      summary: fields.summary.trim(),
      startISO: fields.startISO,
      endISO: fields.endISO,
      location: fields.location?.trim() || undefined,
    });
    revalidatePath("/calendar");
    // Edits aren't undoable (no prior state kept) — same as the assistant's
    // update_event. The undo target is returned for shape parity but the UI
    // won't offer Undo on an edit.
    return { ok: true, event, undo: { calendarId, calendarEventId: eventId } };
  } catch (err) {
    console.error("[calendar] update_event failed:", err);
    return { ok: false, error: "Couldn't save changes to Google Calendar. Try again." };
  }
}

export async function deleteCalendarEvent(eventKey: string): Promise<SimpleResult> {
  const auth = await tokenOrError();
  if ("error" in auth) return { ok: false, error: auth.error };

  const { calendarId, eventId } = decodeEventKey(eventKey);
  try {
    await deleteEvent(auth.token, calendarId, eventId);
    revalidatePath("/calendar");
    return { ok: true };
  } catch (err) {
    console.error("[calendar] delete_event failed:", err);
    return { ok: false, error: "Couldn't delete the event on Google Calendar. Try again." };
  }
}
