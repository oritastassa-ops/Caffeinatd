# 19 — Calendar rebuild

## Why this exists

The old calendar (`calendar/page.tsx`, 105 lines) rendered seven day headings
with a flat list under each. There was no time axis, no proportional duration,
no overlap handling — two events filling an afternoon and two 15-minute calls
looked identical. It wasn't a calendar, it was a grouped list, and it wasted the
one thing calendars are for: showing where a day is dense and where it's free.

This rebuild is real UI engineering: a positioned week/day grid with overlap
packing, an agenda view, DST-correct time math, and full read/write against
Google Calendar through the existing undoable-receipt path.

## Architecture

**Deterministic math, thin React** — the same principle as the planning engine
(`docs`/planning). All the subtle logic is pure and unit-tested; the components
only place boxes.

```
src/lib/calendar/
  dates.ts    calendar-date arithmetic on YYYY-MM-DD labels (week math)
  layout.ts   dayWindow, resolveDayEvents, layoutDay — the tested core
  format.ts   tz-aware ISO ↔ wall-clock ↔ minute-of-day conversions
src/app/(app)/calendar/
  page.tsx    server: auth, token, week fetch, connect/error framing
  loading.tsx skeleton of the grid
  actions.ts  create/update/delete server actions (undoable receipts)
src/components/calendar/
  calendar-view.tsx  orchestrator: view state, nav, keyboard, dialog, toast
  time-grid.tsx      the axis grid (week = 7 cols, day = 1)
  agenda-view.tsx    the list view
  event-dialog.tsx   create / detail / edit / delete
  dialog.tsx         accessible modal shell (focus trap, Escape)
  action-toast.tsx   ✓ + Undo confirmation
```

### The layout engine (`layout.ts`) — the crown jewel

Two pure functions, split so the timezone part and the geometry part test in
isolation:

**`resolveDayEvents(events, dateStr, tz)`** resolves timed events onto one local
day as **wall-clock** minute intervals `[startMin, endMin]`, clipped to
`[0, 1440]`. Wall-clock (not elapsed) positioning is the deliberate choice: a
9am meeting must sit at the "9am" gridline so the axis labels always align. This
is what makes a DST day render sensibly on a uniform grid — see below. All-day
events are excluded; a midnight-crossing event is clipped to the day and appears
in each day it touches (`layout.ts:` `resolveDayEvents`).

**`layoutDay(resolved, { minDurationMin })`** column-packs overlaps the way
Google Calendar does (`layout.ts:` `layoutDay`):

1. Inflate each event to `minDurationMin` (so a zero-length event stays
   clickable *and* two coincident events split instead of stacking), sort by
   start asc / end desc.
2. Sweep into **clusters** — maximal transitively-overlapping runs.
3. First-fit column assignment within a cluster (optimal for interval graphs).
4. `width = 1/columns`, `left = column/columns`.

The consequence worth writing down: in a chain **A–B, B–C, A∦C**, the cluster is
two columns wide, so A and C share a column at half width — *not* thirds. Naive
implementations that count cluster size get this wrong; `calendar-layout.test.ts`
guards it explicitly.

Output is unitless — minutes vertical, fractions `[0,1]` horizontal. `time-grid`
multiplies by `PX_PER_MIN` and column width. That's what lets overlap,
clipping and DST be tested without a DOM.

### DST, honestly

`dayWindow(dateStr, tz)` computes `[midnight, next-midnight)` as real UTC
instants, so `lengthMin` is 1380 on spring-forward and 1500 on fall-back — never
a hardcoded 1440 (`layout.ts:` `dayWindow`). It's used for the fetch range and
is available for a DST note.

The **grid itself uses a uniform 24-hour axis with wall-clock positioning**,
which is exactly how Google Calendar renders DST days:

- **Spring-forward**: the 2am hour doesn't exist, so that band is simply empty —
  no valid wall time lives there. A 9am meeting still sits at 9am.
- **Fall-back**: 1–2am happens twice; both instances resolve into the same band
  and `layoutDay` splits them side by side. `calendar-layout.test.ts` asserts
  both 1:30am instances land at minute 90.

This keeps axis labels aligned across all seven columns of a week (a per-day
elapsed-minute axis would misalign a 23h column against its neighbours). The
only thing it can't depict is an event literally spanning the transition
instant — a negligible, twice-a-year edge. Tests cover spring and fall both.

### Write path — no fake success

`actions.ts` exposes `createCalendarEvent` / `updateCalendarEvent` /
`deleteCalendarEvent`, each returning a discriminated `{ ok } | { ok, error }`.
The UI shows a ✓ **only** when `ok` is true and the Google write actually
returned — there is no optimistic success, so a failed PATCH never renders as
saved (CLAUDE.md's cardinal rule). Errors are user-facing sentences; raw
provider bodies are `console.error`'d server-side.

Creation is **undoable**: the result carries `{ calendarId: "primary",
calendarEventId }` and `ActionToast` posts it to the existing
`/api/assistant/undo` endpoint — the same trust mechanism the assistant's
receipts use, now driven from a click. Edits and deletes are *not* undoable
(no prior state is kept), matching the assistant's `update_event`/`delete_event`
receipts exactly; delete is guarded by an inline confirm instead.

Free/busy is surfaced where it's actionable: the create/edit dialog computes
overlaps against the loaded week and warns "Overlaps 2 events: …" as you pick a
time — the visual answer to the conflict detection that `findConflicts` did
only for the assistant.

### Views, navigation, mobile

`SegmentedControl` (Phase 11) switches Day / Week / Agenda; the choice persists
in `localStorage`. Navigation is URL-driven (`?date=`): the server fetches the
week containing the anchor, so view-switching needs no refetch and only
prev/next changes the URL. Prev/next moves ±1 day in Day, ±7 in Week/Agenda.

**Mobile forces Agenda** via `matchMedia("(max-width: 640px)")`, not just CSS —
a 7-column time grid is unusable at 390px, so it's never rendered there, and the
segmented control hides. Agenda is treated as the *right* answer for a phone or a
sparse week, not a fallback; creation still works there through the "New event"
button.

### Keyboard

Day headers are a roving-tabindex group: `←/→` move between days, `Enter` opens a
create draft for the focused day, `Esc` closes any dialog (trapped focus,
restored on close). Events are buttons — `Tab` to them, `Enter` opens detail.

## Out of scope (as briefed)

Drag-to-move / drag-to-resize (the assistant already handles "move my 3pm" via
`update_event`); month view; multiple write calendars (writes go to primary — an
existing documented limitation); recurring-event editing beyond the API.

## Tests

`tests/calendar-layout.test.ts` (19) against the pure engine: non-overlap keeps
full width; two split 50/50; three split in thirds; the partial-overlap chain
shares a column; zero/short events get a minimum footprint; separate clusters
reset; midnight-crossing clips into both days; DST spring and fall day lengths
and positioning; the fall-back repeated-hour split; and an end-to-end pack of a
real morning in a real timezone.

## Self-critique

- **The grid is not rendered in an automated test.** The math is exhaustively
  covered, but the React placement (px mapping, click-to-minute, now-line) is
  verified by eye, not by jsdom — consistent with the repo's "test the logic,
  not the pixels" stance, but it means a regression in the pixel mapping
  wouldn't fail CI.
- **A DST-spanning event is drawn slightly wrong.** An event covering the exact
  transition instant is off by the hour on the uniform axis. It's the accepted
  Google-Calendar compromise and twice-a-year, but it is a known inaccuracy.
- **Edits can't clear a field.** `updateCalendarEvent` omits empty optionals, so
  you can't blank an existing location via the dialog (only overwrite it). And
  the edit form doesn't preload the event description, because `listEvents`
  doesn't return it — so notes are create-only.
- **Week fetch is capped at Google's `maxResults: 50` per calendar.** A pathologically
  busy week could truncate; pagination is noted as a future extension, matching
  the agenda cache's existing limitation.
- **Navigation refetches the whole week on each step.** Fine at this scale (the
  10s agenda cache absorbs repeats), but there's no prefetch of adjacent weeks,
  so a fast prev/next feels a beat slower than a client-cached calendar would.
- **All-day multi-day events render per-day, not as a spanning bar.** Correct but
  less pretty than a continuous ribbon across columns.
```
