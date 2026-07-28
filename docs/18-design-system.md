# 18 — Design system foundation

## Why this exists

The UI read as unintentional because there was almost nothing shared to be
intentional *with*. `src/components/ui.tsx` exported four things — `Card`,
`CardTitle`, `PriorityBadge`, `EmptyState` — and every button, input, header,
stat and layout on nineteen pages was hand-rolled inline Tailwind. Drift was
guaranteed: `login/page.tsx` and `tasks/page.tsx` built the same primary button
by hand and disagreed on padding; radius was a coin-flip between `rounded-xl`
(93 uses), `rounded-2xl` (8), `rounded-lg` (23) and `rounded-md` (15).

The palette in `globals.css` was the best thing about the design and defined a
scale for *nothing else* — one hardcoded `border-radius: 6px` and no spacing,
radius, elevation, motion or type ramp. Restyling pages that share no primitives
just produces new variations of the same problem. So this phase builds the
vocabulary first: tokens, primitives, and three converted pages as the pattern
the rest of the app follows.

## The token layer — `src/app/globals.css`

The color tokens are unchanged; everything below sits alongside them in the
`@theme inline` block (so Tailwind generates utilities) or in `:root`.

### Radius — three steps, and only three (`globals.css:53`)

| Token | Value | Utility | Use for |
|-------|-------|---------|---------|
| `--radius-control` | 8px | `rounded-control` | buttons, inputs, selects, checkboxes, focus ring |
| `--radius-card` | 12px | `rounded-card` | cards, panels, dialogs, inset boxes |
| `--radius-pill` | full | `rounded-pill` | badges, chips, segmented control |

`control < card` is deliberate — interactive controls read tighter than the
panels that hold them (Linear and Stripe both do this). `--radius-card` equals
the old `rounded-xl`, so existing cards didn't move. Every rounded thing now
picks one of these three; nothing invents its own radius.

### Elevation — border-only, with one named exception (`globals.css:62`)

In-flow surfaces (cards, inputs, sections) are **border-only**. A neutral
drop-shadow reads as *dirt* on a warm cream background, so the app uses hairline
borders and defined hover/active border states instead — this is a rule, not an
accident. Hover raises the border (`hover:border-accent`), it never adds a
shadow.

The one exception is `--shadow-overlay`, reserved exclusively for genuinely
floating layers — the ⌘K palette, dropdowns, toasts, the companion bubble. It is
tinted with the bean brown (`color-mix` against `--bean`) so it warms the
surface rather than smudging it. Two rules, both enforceable by grep: in-flow =
border; floating = `shadow-overlay`, nothing else.

### Motion — three durations, one easing (`globals.css:79`, `:183`)

`--motion-fast` (150ms), `--motion-base` (200ms), `--motion-slow` (300ms) drive
the `.transition-fast` / `.transition-base` / `.transition-slow` utilities.
Fast for hover/press feedback, base for state changes, slow for larger moves.
`--ease-standard` (`cubic-bezier(0.16, 1, 0.3, 1)`) is the shared curve for
anything that isn't a spring entrance. All three collapse to `0.01ms` under
`prefers-reduced-motion` — motion is never load-bearing.

### Type ramp — owned by the primitives

Five levels: **title** (`text-title`, 24px — `PageHeader` h1), **heading**
(`text-heading`, 18px — sub-headings), **body** (`text-sm`), **label**
(`text-xs` uppercase — `CardTitle`, `Stat` label), **caption** (`text-[11px]` —
`Badge`, stat micro-labels). Only `title`/`heading` became new tokens, because
those were the copy-pasted combos (`text-2xl font-semibold tracking-tight`).
Body/label/caption stay as the existing Tailwind sizes — minting parallel
`text-body`/`text-label` tokens would just duplicate Tailwind's scale and give
two ways to say the same thing. The ramp is applied *inside* primitives, so
pages never pick a text size by hand.

### Spacing

The app uses the 4px-based Tailwind ramp restricted to steps **2 / 3 / 4 / 6 /
8 / 12 / 16**. Standard vertical rhythm between page sections is `gap-4`; inside
a card, `gap-2`/`gap-3`. This is a convention, not a token — Tailwind already
gives the values; the decision is which steps we use.

## The primitives — `src/components/ui/`

`ui.tsx` became a `ui/` folder (small files, one concern each) with a barrel at
`index.ts`; imports of `@/components/ui` are unchanged. Pure class-mapping and
state logic live JSX-free in `styles.ts` so they're unit-testable in the
node-only test env.

| Primitive | Use this when… |
|-----------|----------------|
| `Button` | any real button. Variants `primary` / `secondary` / `ghost` / `danger`, sizes `sm` / `md`, `loading` (implies disabled). Presentational — works in server components and forms. |
| `LinkButton` | a `<Link>` that should look like a button (Connect, Manage). Same class vocabulary as `Button`. |
| `Input` / `Textarea` / `Select` | form controls. Own their `label` / `hint` / `error` and wire `aria-describedby` + `aria-invalid` off `id ?? name`, no hook — so they stay usable in server components. |
| `PageHeader` | the top of every page: `title` + optional `description` / `action` / `back`. Replaces the hand-written `<h1>`. |
| `Section` | an **un-boxed** titled group over a run of cards or a grid (where a `Card` border would be one box too many). `Card` is the boxed counterpart. |
| `Stat` | one metric tile: label, tabular value, optional `sub` / `delta` / `tone`. `children` is a slot for a future sparkline. |
| `Card` / `CardTitle` | a bordered surface and its label heading. Unchanged from before. |
| `Badge` / `PriorityBadge` | a semantic pill. `PriorityBadge` is now a thin `Badge` wrapper; the same primitive backs the notification status chips. |
| `Skeleton` | a pulsing placeholder; compose several in a `loading.tsx`. Pulse stops under reduced-motion. |
| `SegmentedControl` | view switching (calendar day/week, trend ranges). A proper `radiogroup`: roving tabindex, arrow/Home/End nav, `aria-checked`. |

**Rules for all of them:** keyboard reachable, visible focus ring (global
`:focus-visible`), WCAG AA in both themes, no fixed pixel heights — sizing is
padding-based so controls grow with text. `Input` padding matches `Button md`
so a control and a button line up in a row (`styles.ts:63`).

### The one rule that matters most

**New UI composes these primitives; it does not write inline Tailwind for
things a primitive covers.** A new button is `<Button>`, not a styled
`<button>`. A new form field is `<Input>`, not a bordered `<input>`. When a
primitive is missing, add it here — don't hand-roll it on the page. This is the
whole point of the phase: the vocabulary only stays coherent if it's the default
path.

### No component library

No shadcn, no Radix. `SegmentedControl` was the one plausible case for a
headless dependency (radiogroup keyboard semantics) and it's ~40 lines of
hand-rolled roving tabindex instead — see `nextSegmentIndex` in `styles.ts:122`.
A headless primitive would be justified only for a genuinely hard a11y problem
(a dialog focus-trap, a combobox); it hasn't come up yet.

## Reference conversions

Three pages, chosen to exercise different axes, are the pattern Phase 13
follows:

- **`tasks/page.tsx`** (list) — `PageHeader`, `Input` + `Button` quick-add.
- **`nutrition/page.tsx`** (metric) — `PageHeader`, four `Stat`s; deleted its
  local `Stat`.
- **`settings/page.tsx`** (form) — `PageHeader`, seven `Input`s, three
  `Select`s, `Button` (primary + danger), `LinkButton` (primary + secondary);
  deleted its local `Field` + `inputCls`. Swapped in for the originally
  suggested `settings/notifications`, which is a 20-line composition shell whose
  form controls live in child components — converting it would have exercised
  none of the new form primitives.

None of the three contains a hand-rolled button or input.

## Tests — `tests/design-system.test.ts`

The test env is node-only (no jsdom/RTL, `include` is `*.test.ts`), so the logic
was extracted into `styles.ts` and tested there: variant→class mapping,
`loading`-implies-`disabled` precedence, error-border gating, `aria-describedby`
id derivation, priority→tone mapping, and the `SegmentedControl` keyboard
contract. 18 assertions.

## Self-critique

- **Ref/prop forwarding isn't unit-tested.** React 19 ref-as-prop plus `...rest`
  makes it correct by construction, but "correct by construction" isn't a test.
  Verifying it properly means adding jsdom + Testing Library — a dependency and a
  second test environment I chose not to add for one assertion. If component
  rendering tests earn their keep later, that's the trigger.
- **~~`cn` doesn't merge conflicting Tailwind classes.~~** *(Fixed.)* The
  primitives now compose through `cx` (`src/components/ui/cx.ts`), which wraps
  `tailwind-merge` so a caller's `className` reliably overrides a primitive's
  defaults — e.g. `Stat` passing `p-4` to a `Card` whose default is `p-5` now
  resolves to `p-4` instead of leaving both in the string and trusting
  stylesheet order. The global `cn` in `@/lib/utils` is unchanged (plain join);
  only the design-system primitives use `cx`, keeping the blast radius small.
- **Two ways to say some sizes.** `text-title` coexists with `text-2xl`, and
  `rounded-card` with `rounded-xl`, until Phase 13 migrates the other sixteen
  pages. During that window the codebase has both vocabularies; grep for the raw
  utilities to find what's unconverted.
- **`Section` and `SegmentedControl` ship unused by the three reference pages.**
  They're built and tested for Phase 12 (calendar) and Phase 13, but a primitive
  with no in-repo caller is a primitive whose ergonomics haven't been pressure-
  tested. Treat their APIs as provisional until the calendar uses them.
- **Light/dark was verified by construction, not by eye.** Every primitive uses
  only existing dual-theme semantic tokens and introduces no new color, so both
  themes inherit correctly — but I did not do a per-surface visual pass in a
  browser. That spot-check is worth doing before Phase 13 leans on these.
