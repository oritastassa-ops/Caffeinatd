-- Hevy integration. Additive only — run once, after 002_phase1.sql.
-- Table name and shape are provider-agnostic on purpose: Garmin/Strava/Whoop
-- reuse this same table later, just a new `provider` value.

create table if not exists fitness_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('hevy')),
  encrypted_api_key text not null, -- AES-256-GCM ciphertext; never returned to the client
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  provider_user_id text,
  provider_username text,
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  metadata jsonb not null default '{}'::jsonb, -- headroom for provider-specific extras later
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table fitness_integrations enable row level security;
create policy "own fitness integrations" on fitness_integrations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Workout provenance (source tracking + sync dedup) ────────────────────────
alter table workouts add column if not exists source text not null default 'manual' check (source in ('manual', 'hevy'));
alter table workouts add column if not exists provider_workout_id text;
alter table workouts add column if not exists raw jsonb; -- full provider payload, for future analytics

create unique index if not exists workouts_provider_dedup_idx
  on workouts (user_id, source, provider_workout_id)
  where provider_workout_id is not null;

-- ── Richer set detail (what Hevy actually reports per set) ───────────────────
alter table workout_sets add column if not exists set_type text not null default 'normal';
alter table workout_sets add column if not exists distance_meters numeric(8, 2);
alter table workout_sets add column if not exists duration_seconds integer;
alter table workout_sets add column if not exists rpe numeric(3, 1);
alter table workout_sets add column if not exists notes text; -- exercise-level notes, repeated per set
