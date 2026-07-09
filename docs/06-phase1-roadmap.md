# Phase 1 — Analysis & Implementation Roadmap

Baseline: [docs/05-technical-product-review.md](05-technical-product-review.md). This plan extends
the existing architecture — no rewrite. Every new piece follows established patterns already in
the codebase: Zod tool schemas as the single source of truth, RLS-scoped Postgres tables, server
actions for manual CRUD, deterministic math where determinism is available (proven out by the
sleep-time calculator), and the existing provider-agnostic `AIProvider` interface untouched.

## Scoping decisions (stated up front, not hidden later)

- **Insights are deterministic, not LLM-generated.** Each insight is a rule evaluated against real
  rows (overdue-task count, weekly workout cadence, protein pace, same-day calendar overlap). This
  is cheaper, faster, trivially explainable ("why am I seeing this" = the rule that fired), and
  doesn't add more load against a Gemini quota that has already broken once this session. If a
  domain later needs genuine judgment (not just thresholds), that's an additive LLM call on top of
  this pipeline, not a replacement for it.
- **No new "agent" classes.** The brief allows a planner/memory/insight agent "if it provides real
  value." The existing `lib/pipeline`, `lib/memory`, and a new `lib/insights` module already give
  clean separation; wrapping them in an agent abstraction would add indirection without new
  capability.
- **Reminders ship as a real, correctly-modeled foundation, not a full notification product.**
  Schema and a creation tool exist; delivery is in-app only (a due-soon list on Today). Push/email
  are deferred exactly as the brief allows ("build the foundation correctly").
- **Memory confirmation is a real UI flow**, not a stub: a new `suggest_memory` tool (for inferred
  facts) returns a receipt with Remember/Don't-remember buttons instead of auto-saving; the
  existing `save_memory` tool (for facts the user states directly) keeps auto-saving, since asking
  "should I remember that you just told me X" would be annoying, not delightful.

## Database changes

New migration `supabase/migrations/002_phase1.sql` (additive — the original `schema.sql` used bare
`create policy` with no `if not exists` guard, so it's only safe to run once; all Phase 1 changes
go in a new file):

- `memories`: add `confidence` (1–5, default 5), `usage_count` (default 0, incremented on recall),
  `updated_at`. Ranking moves from "similarity above threshold" to a combined score (similarity +
  importance + recency + usage) computed in application code against a wider candidate pool —
  kept in JS specifically so it's unit-testable without a live database.
- `profiles`: add `onboarded_at` (null = show onboarding), and `communication_style` inside the
  existing `settings` jsonb (no new column needed).
- New table `insights` (id, user_id, domain, message, reason, importance, dedup_key, created_at,
  expires_at, dismissed_at, acted_on) with a unique constraint on `(user_id, dedup_key)` so
  re-running generation never duplicates a still-relevant insight.
- New table `reminders` (id, user_id, linked_table, linked_id, message, remind_at,
  notification_type, completed_at, created_at).
- RLS policies for both new tables, identical ownership pattern to every existing table.

## API / backend changes

- `src/lib/insights/generate.ts` — one function per domain (fitness, nutrition, calendar, tasks),
  each a pure-ish function taking already-fetched data and returning candidate insights; a
  top-level `generateInsights()` runs them all and upserts with `ON CONFLICT DO NOTHING`. Called
  from the Today page on every load (cheap — Postgres reads only, no AI call) and from the existing
  daily-plan cron for the "real scheduled job" path once deployed.
- `src/lib/planning/readiness.ts` — pure, unit-tested function computing the 0–100 "day score" from
  overdue tasks, weekly workout cadence vs. this week's actual count, today's protein-logging pace,
  and same-day calendar overlaps — each with a human-readable reason string, not a black box.
- `src/lib/memory/ranking.ts` — pure, unit-tested scoring function extracted from `recallMemories`.
- Two new tools in `src/lib/pipeline/tools.ts`: `suggest_memory` (inferred fact, needs
  confirmation) and `create_reminder`. `ActionReceipt` gains an optional `confirm` variant
  alongside the existing `undo` variant.
- New route `POST /api/assistant/confirm-memory` — the "Remember" button's target; performs the
  actual insert that `suggest_memory` deferred.
- `src/app/onboarding/actions.ts` — converts wizard answers into `profiles.settings` fields plus a
  batch of `memories` rows, and sets `onboarded_at`.

## UI changes

- Today page rebuilt around: greeting, a Readiness card (score + expandable "why" breakdown),
  a Focus card (top 3, sourced from the existing daily plan or a task fallback), a Smart
  Suggestions card (live insights, dismissible), a due-soon Reminders strip (only rendered if any
  exist), and a Quick Actions row that opens the command bar pre-filled via a small custom-event
  bridge (`caffeinatd:open-command-bar`) rather than new global state.
- Command bar: renders Remember/Don't-remember buttons for `confirm`-type receipts, listens for the
  quick-action open event.
- Memory page rebuilt as grouped sections ("Sarah's World" framing) with inline editing, a manual
  "add a memory" form, and confidence/last-used metadata shown per row.
- New `/onboarding` route (own minimal layout, no sidebar) — a multi-step wizard; the `(app)`
  layout redirects there when `profiles.onboarded_at` is null.

## Implementation order

1. Migration + types.
2. Memory ranking/dedup/edit (foundation the insight engine and onboarding both write into).
3. Insight generation engine + Today page's Smart Suggestions card.
4. Today page full redesign (readiness, focus, quick actions).
5. Reminder schema + tool + due-soon surfacing.
6. Onboarding wizard.
7. Tests, typecheck, build.

Proceeding in that order below.
