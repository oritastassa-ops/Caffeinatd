# Phase 6 — Body metrics

Read `CLAUDE.md` first; its rules apply throughout. Then `docs/02-architecture.md` and
`docs/08-fitness-intelligence-plan.md`.

## Goal

A general time-series layer for measurements about the body, and the first three series on top
of it: **weight**, **sleep actuals**, and **resting heart rate**.

Caffeinatd currently tracks what you *did* (workouts via Hevy, meals) and what you *should do*
(prescribed sleep in `src/lib/planning/sleep.ts`). It tracks nothing about what your body is
actually doing. `fitness_metrics` is per-exercise, not per-person. There is no weight anywhere in
the schema. `readiness.ts` scores your day from task counts and protein logged — never from
whether you slept.

That is the gap. Fix the substrate, not just the three series, because Phase 8 (Apple Health)
will pour a dozen more into it.

## The central design decision

**One generic `body_metrics` table, or one table per metric?**

I lean generic — `(user_id, metric, measured_at, value, unit, source)` — because Apple Health
will bring steps, HRV, VO2max, body fat, blood pressure, and a per-metric table for each is
absurd. But generic time-series tables have real costs: no type safety on `value`, awkward
queries when metrics have different shapes (blood pressure is two numbers), and the unit column
becomes a source of silent bugs.

**Decide this deliberately and justify it before writing the migration.** If you go generic,
address: how a two-component metric like blood pressure is represented, how units are validated
(a `kg` row and a `lb` row in the same series is a data-integrity bug waiting to happen), and
whether `metric` is a check constraint or a lookup table. If you go per-metric, address what
Phase 8 does with twelve of them.

I want your recommendation with reasoning. Disagree with me if the generic approach is wrong.

## Deliverables

### 1. Migration `supabase/migrations/011_body_metrics.sql`

Whatever shape you argued for, plus:

- **Canonical units stored, display units converted.** Store weight in kg, always. The user's
  preferred display unit goes in `profiles.settings` (which already holds `calorieGoal`,
  `sleepHours`, etc. — see `supabase/schema.sql:9`). `src/lib/fitness/units.ts` already does
  kg/lb conversion; reuse it rather than writing a second one.
- **Deduplication on `(user_id, metric, measured_at, source)`.** Phase 8 will re-import
  overlapping Apple Health exports; without this you get duplicate rows silently skewing every
  average. A partial unique index, same pattern as `notification_deliveries_dedupe_idx` in
  `008_notifications.sql:83`.
- **`source`** distinguishes `manual` / `apple_health` / `hevy` / future integrations. When two
  sources disagree for the same instant, define the precedence rule in code, not by accident.
- RLS matching the existing `user_id = auth.uid()` pattern.

### 2. `src/lib/health/` — the pure logic

New folder, mirroring how `src/lib/fitness/` is organized. All pure functions, all unit-tested:

- **`series.ts`** — bucketing raw points into daily/weekly series, gap handling (a missing day is
  not a zero — this distinction matters and is easy to get wrong), and rolling averages.
- **`trend.ts`** — direction and rate of change over a window. Weight is the motivating case:
  day-to-day weight is mostly water noise, so a 7-day moving average with a linear fit over
  14–28 days is the honest signal. **Do not report a trend from two data points.** State a
  minimum-points threshold and return "insufficient data" below it.
- **`sleep.ts`** — sleep *actuals*: duration, midpoint, consistency (standard deviation of
  sleep midpoint is a better regularity measure than bedtime variance; use it and explain why in
  a comment). Keep this separate from `src/lib/planning/sleep.ts`, which is prescriptive. Two
  different things; do not merge them.

### 3. Wire into readiness

`src/lib/planning/readiness.ts` computes a 0–100 score from `ReadinessInput` (see
`readiness.ts:4-14`). Extend it with sleep debt and, if present, a resting-HR deviation from
baseline.

Two constraints:

- **Every deduction stays named.** The file's own comment says the score is "explicitly not meant
  to be a black box" and every deduction appears in `reasons`. New inputs follow that.
- **Degrade gracefully.** A user with no sleep data must get the same score they get today, not a
  penalty for missing data. Make the new inputs optional and prove it with a test.

Also feed sleep actuals into `src/lib/planning/daily.ts` so the morning plan can say something
true about last night instead of only prescribing tonight.

### 4. Assistant tools

Extend `src/lib/pipeline/tools.ts` — read it first and match the existing `.describe()` style:

- **`log_metric`** — `{ metric, value, unit?, measured_at? }`. Handles "I'm 74.2 kg this
  morning", "slept 6 hours", "resting HR was 52".
- **`get_metric_trend`** — `{ metric, days? }`. Returns the computed trend, not raw points; the
  model should not be doing arithmetic on a list of numbers.

Executor handlers in `src/lib/pipeline/executor.ts`, with undoable receipts like every other
mutation, and `error` checked on every write.

### 5. Surface

Extend the Fitness page or add `/health` — your call, argue for it. Minimum: a weight sparkline
with the moving average overlaid on the raw points (showing both is the honest presentation —
it makes the noise visible instead of hiding it), current sleep-consistency figure, and manual
entry that doesn't require ⌘K.

Charting: the repo uses CSS and minimal inline SVG deliberately (`docs/04-roadmap.md` calls a
chart library a "drop-in later"). A sparkline does not justify a dependency. If you think it now
does, argue for it.

### 6. Docs

`docs/15-health-metrics.md` in the house format — why the schema is shaped that way, the unit
and dedupe strategy, the trend-confidence threshold, and a self-critique naming the weakest
point.

## Tests

- Series bucketing: missing days stay missing, timezone boundaries land in the right bucket, DST
  both directions.
- Trend: known input → known slope; below-threshold input → "insufficient data"; noisy weight
  series → the moving average is stable where raw points are not.
- Unit conversion round-trips without drift.
- Dedupe: re-importing the same point is a no-op.
- Readiness with no metrics scores identically to today's implementation.

## Out of scope

Apple Health import (Phase 8). Nutrition (Phase 7). Any medical interpretation.

## Explicit boundary — this is not a medical device

Do not compute, display, or let the assistant state anything diagnostic. No "your resting heart
rate suggests," no interpretation of blood pressure, no inference about health conditions.
Descriptive statistics about numbers the user recorded, and nothing beyond that. Where a metric
could invite medical reading, the UI stays neutral and factual.

I'm pre-med, which is exactly why I want this line drawn hard rather than blurred.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- "I weighed 74.2 kg this morning" through ⌘K stores a point; "how's my weight trending" returns
  a real trend or an honest refusal.
- Readiness is unchanged for a user with no body metrics.
- `docs/15-health-metrics.md` exists with its self-critique.
- One commit, imperative message.

Start with your recommendation on the generic-vs-per-metric question and your plan. Push back on
anything here you'd design differently.
