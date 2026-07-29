# Phase 13 — Migrate the remaining surfaces

Read `CLAUDE.md` and `docs/18-design-system.md` first. Requires Phase 11; ideally Phase 12.

## Goal

Convert every remaining page to the design system, and fix the layout problems that a component
swap alone won't solve.

Phase 11 built the vocabulary and proved it on three pages. This is the unglamorous part where the
app actually becomes consistent. The measure of success is that a user moving between Finance,
Fitness, and Home cannot tell they were built at different times.

## Scope check first

Sixteen pages remain. **This is probably two sessions, not one.** Read the list, then tell me how
you'd split it before writing code. A suggested cut:

- **13a — the big ones:** `page.tsx` (Today, 520 lines), `fitness` (269), `home` (262),
  `settings` (212)
- **13b — the rest:** finance and its two subpages, fitness detail, workspaces, memory, notes,
  tasks leftovers, home subpages, focus

If you can do it in one clean pass, say so and do it. Don't rush it to fit.

## Part A — The Today page

`src/app/(app)/page.tsx` is 520 lines — nearly double the next largest. It renders the timeline,
quick capture, deadlines, notes, workspace tiles, and recent conversations in one file.

Break it up. Each region becomes a component in `src/components/` alongside the existing
`Timeline`, `WorkspaceCard`, `QuickCapture`. The page becomes composition and data fetching.

Then reconsider the **layout**, not just the styling. It's the screen the user opens first and most
often, and it should answer "what matters right now" above the fold. Right now everything is
weighted equally in a single column. Consider a genuine hierarchy — the next commitment and today's
plan prominent, secondary regions denser or below. Argue for a structure; don't just restack what's
there.

## Part B — Density and space

The user's specific complaint is space usage. Two patterns to look for on every page:

1. **Uniform card padding regardless of content.** A card holding one number and a card holding a
   twelve-row table should not have identical internal spacing. Use the Phase 11 spacing scale
   deliberately — dense where content is dense.
2. **Single-column layouts on wide screens.** Several pages leave most of a desktop viewport empty
   while forcing scroll. Where content is genuinely parallel (accounts and net worth; chores and
   shopping; muscle recovery and PRs), use a real responsive grid rather than stacking.

Neither means cramming. Generous whitespace is in the design bar and stays — the goal is
*intentional* space, where the amount reflects what the content needs.

## Part C — States

Per `CLAUDE.md`, every async surface needs loading, empty, and error states, and an empty state
says something useful.

Audit all sixteen. Most currently have a bare `EmptyState` or nothing. An empty Finance page should
say what connecting an account gets you; an empty Memory page should explain what memory is and how
things land there. This is where a lot of the "unintentional" feeling actually lives — an app that
says "No results" three times reads as unfinished regardless of how good the typography is.

Add skeletons matching each page's real layout, not a generic spinner.

## Part D — Mobile and keyboard

- Every page usable at 390px. Tables become cards or scroll containers deliberately, not
  accidentally.
- Check the sidebar and mobile nav (`src/components/sidebar.tsx`) still work with any layout
  changes.
- Tab order follows visual order on every page. Visible focus rings everywhere.
- The app is keyboard-first — ⌘K is the primary interface. Any new interactive element is reachable
  without a mouse.

## Part E — Cleanup

- Remove inline Tailwind that duplicates a primitive. After this phase, a hand-rolled `<button
  className="rounded-xl bg-accent...">` anywhere in `src/app/` is a bug.
- Delete dead styles from `globals.css` that the token layer replaced.
- Consistent page titles via `PageHeader`.

## Tests

Logic only, per the repo's convention. If breaking up the Today page extracts any computation
(grouping, sorting, bucketing), that computation gets a unit test on the way out — it currently has
none because it's buried in a component.

## Out of scope

New features. Charts. The calendar (Phase 12). Animation beyond the Phase 11 motion tokens.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- No page renders a hand-rolled button, input, or page title.
- Every page has meaningful loading, empty, and error states.
- Every page works at 390px and in both themes.
- Today is composed of components, not a 520-line file.
- One commit per session, imperative message.

Start with the split recommendation and your proposed Today layout. If you think Part B's
density read is wrong — that the current spacing is right and the problem is elsewhere — tell me;
you're looking at the rendered structure more closely than I am.
