# Hevy Integration — Analysis & Plan

## 1. Existing Fitness implementation (as-is)

`workouts` (id, user_id, performed_on, kind, title, duration_min, distance_km, notes) +
`workout_sets` (workout_id, user_id, exercise, set_no, reps, weight_kg) — flat, manual-entry only,
via the `log_workout` tool or nothing else (no manual-entry form on the Fitness page). The page
shows two stat cards (workout count, 7-day volume) and a history list. No provider concept exists
anywhere in the schema.

## 2. Existing Settings page (as-is)

A single `updateProfile` form (name/timezone/goals), a Google Calendar connect/disconnect block, a
read-only AI-provider display, and data export/sign-out. No pattern yet for a *third-party
integration* with its own connect/test/disconnect lifecycle — Google Calendar's OAuth flow is the
closest precedent (token storage + connect/disconnect), but Hevy uses a static API key, not OAuth.

## 3. The real Hevy API (fetched from `https://api.hevyapp.com/docs/json`, not assumed)

- Auth: header `api-key: <uuid>` on every request. Requires a Hevy Pro subscription; key comes
  from `https://hevy.com/settings?developer`.
- `GET /v1/user/info` → `{ data: { id, name, url } }` — no email/avatar, just id/display-name/profile-url.
- `GET /v1/workouts?page&pageSize` (pageSize max 10) → `{ page, page_count, workouts: Workout[] }`.
- **`GET /v1/workouts/events?since&page&pageSize`** → `{ page, page_count, events: (Updated|Deleted)[] }`.
  Explicitly documented as "the intention is to allow clients to keep their local cache of workouts
  up to date without fetching the entire list" — `since` defaults to `1970-01-01T00:00:00Z`, so
  **this single endpoint serves both first-sync backfill and every incremental sync after it.**
  `Updated` events carry a full `Workout`; `Deleted` events carry `{ id, deleted_at }`.
- `Workout`: id, title, routine_id, description, start_time, end_time, updated_at, created_at,
  exercises[] → each: index, title, notes, exercise_template_id, supersets_id, sets[].
- `Set`: index, type (`normal`/`warmup`/`dropset`/`failure`), weight_kg, reps, distance_meters,
  duration_seconds, rpe, custom_metric — all nullable except index/type.

This shapes the design directly: no polling-and-diffing needed, no custom cursor — Hevy's own
`events` endpoint with a stored `since` timestamp is the entire sync engine.

## 4. Database changes

New, provider-agnostic table (not Hevy-specific) so Garmin/Strava/Whoop slot in later without a
schema rewrite:

```sql
fitness_integrations (
  id, user_id, provider text check (provider in ('hevy')),  -- widen the check later, additively
  encrypted_api_key text,        -- AES-256-GCM ciphertext, never returned to the client
  status text check (status in ('connected','error','disconnected')),
  provider_user_id text, provider_username text,
  last_synced_at timestamptz, last_sync_status text, last_sync_error text,
  metadata jsonb default '{}',   -- headroom for provider-specific extras later
  unique (user_id, provider)
)
```

`workouts` gains `source` (`manual`/`hevy`), `provider_workout_id`, `raw jsonb` (the full Hevy
payload, for analytics fields we don't have typed columns for yet — future-proofing per the brief,
without inventing columns for every niche field like `custom_metric` or `supersets_id` today).
Unique index on `(user_id, source, provider_workout_id)` where non-null — this is the sync engine's
dedup key. `workout_sets` gains `set_type`, `distance_meters`, `duration_seconds`, `rpe`, `notes`
(exercise-level notes, repeated per set — a small, accepted redundancy rather than introducing a
new `exercises` table, since the existing model is intentionally flat).

## 5. API routes

`POST /api/integrations/hevy/test` (validate a key, return username + latest workout date — never
the key), `POST /api/integrations/hevy/connect` (store encrypted, run an initial sync inline),
`POST /api/integrations/hevy/sync` ("Sync Now"), `POST /api/integrations/hevy/disconnect` (deletes
the integration row; imported workouts stay — disconnecting stops future imports, it isn't
destructive to history already in Caffeinatd).

## 6. Module boundary

```
lib/integrations/
  crypto.ts      — AES-256-GCM encrypt/decrypt, shared by every future provider
  types.ts       — FitnessIntegration row type + a small IntegrationProvider interface
  registry.ts    — provider name → implementation (one entry today: hevy)
  hevy/
    client.ts    — raw fetch wrapper for the 3 endpoints actually used, typed from the real spec
    mapper.ts    — Hevy Workout → Caffeinatd workout+sets (pure function, unit-tested)
    sync.ts      — the events-endpoint sync loop, dedup via (user_id, source, provider_workout_id)
    errors.ts    — HevyApiError, mirrors the existing ProviderError pattern (retryable/status)
```

Nothing outside this folder ever imports `client.ts` or knows Hevy's wire format — routes and the
Fitness page only see `IntegrationProvider` and the `workouts`/`workout_sets` rows sync produces.

## 7. AI transparency

The AI pipeline already reads from `workouts`/`workout_sets` with no notion of provenance — Hevy-
synced rows land in the same tables the `log_workout` tool writes to, so `generate_daily_plan`, the
fitness insight rule, and any future analysis see one unified history with zero changes required.

## 8. Scope cut, stated up front

Muscle-group tagging ("chest/back/legs trained this week") would need a second Hevy endpoint
(`exercise_templates`) to map each exercise to a muscle group, plus a stored mapping table. That's
a real, separate piece of work — this pass shows **exercises trained** (distinct names) instead,
which is honest about what's actually implemented today.
