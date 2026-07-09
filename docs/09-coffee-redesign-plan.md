# Coffee Redesign + Fitness Program Intelligence — Plan

Reskin + UX + fitness-correctness pass. No backend/AI-pipeline/Hevy rewrite — additive only.

## Why this is low-risk

The app already themes entirely through CSS variables (`--bg`, `--surface`, `--accent`, …) in
`globals.css`. Swapping those values reskins every screen at once — no per-component edits needed
for the palette. New work is additive: a logo, a units layer, a program layer, and dashboard cards.

## Palette — "Coffee Intelligence" (dark-first)

| Token | Role | Dark | Light |
|---|---|---|---|
| `--bg` Dark Roast | app/nav/header background | `#140f0b` | `#f6efe6` (cream) |
| `--surface` Espresso | cards | `#1f1712` | `#fffcf8` |
| `--surface-2` | secondary surfaces | `#2a1f18` | `#efe4d6` |
| `--border`/`--bean` Coffee Bean | borders, accents | `#3a2b20` / `#a06a43` | `#e2d3c2` / `#8a5a37` |
| `--accent` Latte Orange | primary actions, active | `#e2893f` | `#c26a1e` |
| `--text` Cream | text | `#f3e9dd` | `#241812` |

## Priority order (as specified)

1. **Premium UI** — palette, logo/favicon, card-entrance + steam-loading animations, richer empty
   states, sidebar/login/onboarding brand refresh.
2. **User flow** — persistent "Ask Caffeinatd…" entry point on every page; command bar gains
   suggestion chips + recent commands (localStorage) + coffee-steam loading state.
3. **Fitness program intelligence** — a training-split model (Upper/Lower, PPL, Full Body) so the
   assistant recommends the next *session* ("Upper B"), not a muscle ("shoulders"). Fixes the
   stated bug. Threaded into the fitness report tool, Fitness page, daily plan, and scheduling
   insight.
4. **Units** — global kg/lbs preference; stored in kg, displayed per preference across Fitness
   page, workout detail, goals.
5. **Dashboard insights** — Morning Brief hero + glanceable Fitness/Nutrition/Productivity/Recovery
   cards on Today.

## Scope cuts (stated up front)

- **"Custom" program** is selectable but has no day-builder UI this pass — it falls back to the
  existing muscle-recovery recommendation. Real custom-day editing is deferred.
- Program-session matching keys off workout **title** keywords (Hevy titles like "Upper A" match
  cleanly; generic titles fall back to day 1). Not exercise-level classification — that needs the
  Hevy `exercise_templates` endpoint, already flagged as separate scope.
- Units convert **display** only; the AI report keeps kg internally (with the unit noted) so
  deterministic math has one representation.
