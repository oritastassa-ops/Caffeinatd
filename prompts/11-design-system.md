# Phase 11 — Design system foundation

Read `CLAUDE.md` first, especially the design bar section. Then `docs/03-ux.md` and
`src/app/globals.css`.

## The diagnosis

The UI feels unintentional because there is almost nothing shared to be intentional *with*.

`src/components/ui.tsx` exports exactly four things: `Card`, `CardTitle`, `PriorityBadge`,
`EmptyState`. Every button, input, page header, section, stat, and layout on nineteen pages is
hand-rolled inline Tailwind. The result is predictable drift — `src/app/login/page.tsx` and
`src/app/(app)/calendar/page.tsx` both build the same primary button by hand and already disagree
on padding (`px-4 py-3` vs `px-4 py-2.5`).

`globals.css` defines a genuinely good color system — cream/espresso, light and dark, semantic
`--good`/`--bad`. It defines **no scale for anything else**: no spacing, no radius, no elevation,
no motion, no type ramp. One hardcoded `border-radius: 6px` at line 72 and nothing else. So every
page picks `rounded-xl` or `rounded-2xl` by feel, and they diverge.

**This is the root cause, and it must be fixed before any page-level polish.** Restyling nineteen
pages that share no primitives produces nineteen new variations of the same problem. Build the
vocabulary first.

## Scope

This phase ships tokens, primitives, and **three converted pages as reference implementations**.
It deliberately does *not* convert everything — Phase 13 does that, and Phase 12 rebuilds the
calendar. If you think that split is wrong, say so before starting.

## Deliverables

### 1. Extend the token layer — `src/app/globals.css`

Keep the existing color tokens exactly as they are; the palette is the best thing about the
current design. Add scales alongside them:

- **Spacing** — a 4px-based ramp. Tailwind already gives you this; the job is to *decide* which
  steps this app uses (say 2/3/4/6/8/12/16) and say so in the doc, so "how much padding" stops
  being a per-component judgment call.
- **Radius** — three steps: control, card, pill. Every rounded thing picks one. Pick real values
  and name them.
- **Elevation** — two or three levels, defined as tokens. The current design uses borders almost
  exclusively, which is a legitimate choice (Linear does it) — if you keep border-only, say so
  explicitly and make it a rule rather than an accident, and define hover/active border states.
- **Motion** — duration and easing tokens. There's a `transition-fast` class in use; formalize it
  into a small set (fast/base/slow) with a shared easing curve. Everything wrapped in
  `prefers-reduced-motion`.
- **Type ramp** — page title, section title, body, label, caption. Right now `text-2xl
  font-semibold tracking-tight` is copy-pasted as the page-title style across pages.

### 2. Grow `src/components/ui.tsx` into a real primitive set

Keep the existing four exports working — Phase 13 depends on not breaking every page at once.

Add at minimum:

- **`Button`** — variants (primary / secondary / ghost / danger), sizes, loading and disabled
  states, `asChild`-style support or a matching `LinkButton` so `<Link>` styled as a button stops
  being hand-rolled.
- **`Input`**, **`Textarea`**, **`Select`** — consistent focus ring, error state, label + hint
  wiring with proper `id`/`aria-describedby`.
- **`PageHeader`** — title, optional description, optional action slot. Nineteen pages currently
  open with a hand-written `<h1>`.
- **`Section`** — a titled region with consistent vertical rhythm.
- **`Stat`** — label, value, optional delta and sparkline slot. Finance, fitness, and nutrition
  all render metrics differently today.
- **`Skeleton`** — the app has `loading.tsx` but no shared loading vocabulary.
- **`Toolbar`** / **`SegmentedControl`** — for view switching, which Phase 12's calendar needs.

Rules for all of them: keyboard reachable, visible focus ring, WCAG AA contrast in both themes,
no fixed pixel heights that break at large text sizes.

**Do not add a component library.** No shadcn, no Radix wholesale. If you want one specific
headless primitive for a genuinely hard accessibility problem (a listbox, a dialog focus trap),
argue for that single dependency on its merits.

### 3. Convert three pages as reference implementations

Pick pages that are small enough to finish well and different enough to exercise the system.
Suggested: `tasks` (65 lines, list-heavy), `nutrition` (89 lines, metric-heavy), and
`settings/notifications` (50 lines, form-heavy). Calendar is deliberately excluded — Phase 12
rebuilds it properly rather than restyling a flat list.

These three become the pattern Phase 13 follows. Get them right rather than fast.

### 4. Document it — `docs/18-design-system.md`

House format: explains *why*, cites `file:line`, ends with a self-critique.

Cover the token scales and when to use each step, the primitive inventory with a one-line "use
this when" for each, the border-vs-shadow decision, the motion policy, and the rule that new UI
composes primitives rather than writing inline Tailwind. That last rule is the whole point — write
it down so future sessions inherit it.

Update `docs/03-ux.md` to point at it.

## Tests

UI stays lightly tested per `CLAUDE.md`. Test the logic that has any: variant→class mapping,
disabled/loading state precedence, that `Button` forwards refs and props correctly.

## Out of scope

Calendar (Phase 12). The other sixteen pages (Phase 13). Charts. Animation beyond tokens. Any new
feature.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- Token scales exist and are documented.
- The three converted pages contain no hand-rolled buttons or inputs.
- Light and dark both still look right — check every converted surface in both.
- `docs/18-design-system.md` exists with its self-critique.
- One commit, imperative message.

Before starting: tell me what you'd add to or cut from the primitive list, and whether you agree
that border-only elevation is the right call for this app's aesthetic. You're looking at more of
the codebase than I summarized here — if the diagnosis is wrong, say so.
