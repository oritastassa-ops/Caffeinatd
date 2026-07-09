# Fitness Intelligence Engine — Analysis & Plan

Builds on [Hevy integration plan](07-hevy-integration-plan.md). No changes to the Hevy client/sync
wire format — this phase adds analysis on top of `workouts`/`workout_sets`, which already carry
`source`/`provider_workout_id` and work identically for manual and synced entries.

## Deliberate architecture deviations from the literal brief (stated up front)

- **No separate `fitness_insights` table.** The existing `insights` table (Phase 1) already has a
  `domain` enum including `'fitness'`, dedup keys, importance, and dismiss/expire — a second,
  near-identical table would be exactly the duplication the brief itself warns against elsewhere.
  New fitness rules (PR achieved, plateau, consistency drop, "schedule your missing muscle group")
  are added to the existing `lib/insights/generate.ts` engine instead.
- **No `fitness_metrics` row is a second source of truth for PRs.** PRs are *computed on demand* by
  comparing a workout's sets against everything before it — `fitness_events` stores the
  *notification* that a PR happened (for the activity feed), not the authoritative record. If the
  computation logic improves later, past events don't silently disagree with fresh math.
- **No new "coaching agent" class.** "How is my bench?" is answered by the *existing* tool-calling
  loop with one new read-only tool (`get_fitness_report`) that hands the model real computed
  numbers to reason over — consistent with the earlier decision not to add agent abstractions.
- **Muscle-group mapping is a local keyword heuristic, not a Hevy API call.** Real muscle-group
  tagging needs Hevy's `exercise_templates` endpoint (flagged as a gap in the Hevy plan doc) — that
  is separate scope. This phase infers group from exercise title keywords, stated honestly as an
  approximation, not Hevy ground truth.
- **Goals live in `profiles.settings`, not a new table** — the brief explicitly says "use the
  existing memory/settings system," and goals are few enough per user that a jsonb array is the
  right level of complexity, not a relational table.
- **Consistency/streaks are computed on the fly** from `workouts.performed_on`, not stored — at
  two-user scale this is cheap enough that caching it would be premature.

## Database changes

`fitness_metrics` (user_id, exercise, estimated_1rm, max_weight_kg, max_reps, total_volume,
volume_7d, volume_30d, frequency_30d, last_performed_on, updated_at) — a **recomputed cache**, not
hand-maintained; refreshed by one pure function after every sync and every manual `log_workout`.

`fitness_events` (id, user_id, type: new_workout/updated_workout/pr/sync_failed, workout_id,
metadata jsonb, created_at) — the activity feed / notification foundation.

`workouts` gains `ai_summary text` (cached on generation, not regenerated every view).
`fitness_integrations` gains `total_imported`, `last_success_at`, `last_failed_at`,
`last_sync_duration_ms`, `syncing_since` (the sync lock).

## Sync triggers (where "automatic" actually fires)

Fitness page load (if stale past a configurable interval), before `generateDailyPlan`, before
`ensureInsights`. **Not** a blanket sync on every navigation/auth event — that would directly
violate "avoid unnecessary API calls" for the sake of literally satisfying every bullet. A DB-level
`syncing_since` lock (checked/cleared server-side) prevents two overlapping syncs regardless of
which trigger fired.

## New tool

`get_fitness_report` — read-only, returns a compact digest (recovery by muscle group, top
exercises' 1RM trend, consistency %, active goal progress) so the assistant can answer open-ended
questions ("how's my bench," "what should I train today," "why am I plateauing") with real numbers
instead of guessing.

## UI

Fitness page reordered: Recovery → Goals → Progress highlights → Recommended next workout →
Training analytics → Recent workouts (now linking to a detail page) → Sync status. Workout detail
moves to its own route (`/fitness/[id]`), not a modal — consistent with this app's server-rendered,
linkable-page pattern rather than introducing client-side routing state.
