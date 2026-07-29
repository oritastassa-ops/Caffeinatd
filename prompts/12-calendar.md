# Phase 12 — Calendar rebuild

Read `CLAUDE.md` and `docs/18-design-system.md` (Phase 11) first. Requires Phase 11.

## The problem

`src/app/(app)/calendar/page.tsx` is 105 lines that render seven day headings with a flat list of
events under each. There is no time axis, no proportional duration, no overlap handling, no sense
of a day's shape. Two events that fill an afternoon and two fifteen-minute calls look identical.

That's why it reads as bad: it isn't a calendar, it's a grouped list. It also wastes the thing
calendars are for — showing you, at a glance, where your day is dense and where it's free.

This is real UI engineering, not restyling, which is why it gets its own session.

## Deliverables

### 1. Week view with a time axis

The primary view. A column per day, an hour axis down the left, events positioned and sized by
their actual times.

The problems to solve, in the order they'll bite you:

- **Positioning.** Event top and height derive from start/end in the *user's* timezone
  (`profile.timezone`), not the browser's and not UTC. `src/lib/utils.ts` already has
  `startOfDayISO` / `endOfDayISO` / `localDateStr` — use them.
- **Overlaps.** Two events at the same time must both be visible. The standard approach is to
  group into overlapping clusters, then split each cluster's width by the number of concurrent
  columns. Put this in a **pure, unit-tested function** in `src/lib/calendar/layout.ts` that takes
  events and returns positioned boxes — no React, no dates-as-strings. This is the part most likely
  to be subtly wrong, and it's the part most worth testing.
- **All-day events** get their own fixed row above the scrollable grid. They have no position on a
  time axis and pretending otherwise breaks the layout.
- **Events that cross midnight** appear in both days, clipped to each.
- **DST.** A day with 23 or 25 hours must render correctly. Test both directions — `CLAUDE.md`
  flags this as the repo's most common real bug source.
- **Viewport.** Don't render 24 hours at equal weight. Scroll to a sensible default (an hour before
  the first event, or ~7am) and let the user scroll. Consider collapsing empty overnight hours —
  but only if it doesn't make the layout math lie about proportions.

### 2. Day and agenda views

A `SegmentedControl` (Phase 11) switching **Day / Week / Agenda**. Persist the choice.

- **Day** — the same grid, one column, more horizontal room for titles and locations.
- **Agenda** — essentially today's list view, kept deliberately. It's better than a grid on a
  phone and better for a sparse week. Don't treat it as the fallback; treat it as the right answer
  for those cases.

**Mobile defaults to Agenda.** A seven-column time grid on a 390px screen is unusable, and
horizontal scroll is not a fix. Make this an explicit rule, not an emergent one.

### 3. Make it useful, not just prettier

The current page is read-only. With `src/lib/google/calendar.ts` already doing full read/write:

- **Click an empty slot to create an event.** Prefill the time from where they clicked.
- **Click an event to see detail**, with edit and delete.
- **Show free/busy gaps meaningfully** — the conflict detection in `findConflicts` already exists
  and nothing surfaces it visually.
- **"Now" line** on today's column. Cheap, and it's the single detail that makes a calendar feel
  alive.

Every mutation goes through the existing undoable-receipt path, and every write checks `error`.

Drag-to-move and drag-to-resize are **out of scope** — high effort, and the assistant already
handles "move my 3pm" through `update_event`. Note them as extensions.

### 4. Empty, loading, and error states

Per `CLAUDE.md`: an empty week says something useful, not "No events." The disconnected-Google
state already exists and is decent — keep its logic, restyle it with Phase 11 primitives. The
"couldn't reach Google Calendar" error path stays and stays actionable.

Skeleton the grid while events load rather than showing an empty grid that fills in.

## Tests

`tests/calendar-layout.test.ts`, all against the pure layout function:

- Non-overlapping events keep full width.
- Two overlapping events split 50/50; three split in thirds.
- Partial overlap chains (A overlaps B, B overlaps C, A doesn't overlap C) — the classic case
  naive implementations get wrong.
- Zero-duration and very short events still get a minimum clickable height.
- Midnight-crossing events clip correctly into both days.
- DST spring-forward and fall-back days.

## Out of scope

Drag interactions. Month view. Multiple calendars (writes go to primary only — an existing
documented limitation). Recurring-event editing beyond what the API already does.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- A week with overlapping meetings renders legibly and proportionally.
- Mobile lands on Agenda and is genuinely usable.
- Clicking an empty slot creates an event; the receipt is undoable.
- Keyboard navigable — arrow keys move between days, Enter opens, Escape closes.
- Both themes checked.
- One commit, imperative message.

Tell me your plan for the overlap algorithm before implementing, and flag if you think Day/Week/
Agenda plus creation is too much for one session — I'd rather split it than get a rushed grid.
