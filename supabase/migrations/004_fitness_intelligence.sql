-- Fitness Intelligence Engine. Additive only — run once, after 003_hevy_integration.sql.

-- ── Recomputed metrics cache (per user, per exercise) ────────────────────────
create table if not exists fitness_metrics (
  user_id uuid not null references auth.users on delete cascade,
  exercise text not null,
  estimated_1rm numeric(7, 2),
  max_weight_kg numeric(7, 2),
  max_reps integer,
  total_volume numeric(10, 2) not null default 0,
  volume_7d numeric(10, 2) not null default 0,
  volume_30d numeric(10, 2) not null default 0,
  frequency_30d integer not null default 0, -- sessions including this exercise, last 30 days
  last_performed_on date,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise)
);
alter table fitness_metrics enable row level security;
create policy "own fitness metrics" on fitness_metrics
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Activity feed / notification foundation ──────────────────────────────────
create table if not exists fitness_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null check (type in ('new_workout', 'updated_workout', 'pr', 'sync_failed')),
  workout_id uuid references workouts on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fitness_events_user_idx on fitness_events (user_id, created_at desc);
alter table fitness_events enable row level security;
create policy "own fitness events" on fitness_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Cached AI workout summary (generated on demand, not on every view) ───────
alter table workouts add column if not exists ai_summary text;

-- ── Actionable insights (e.g. "schedule your missing muscle group") ─────────
-- The action itself is a command-bar preset the user still has to submit —
-- suggestion, never auto-booking.
alter table insights add column if not exists action_preset text;

-- ── Richer integration status + sync lock ────────────────────────────────────
alter table fitness_integrations add column if not exists total_imported integer not null default 0;
alter table fitness_integrations add column if not exists last_success_at timestamptz;
alter table fitness_integrations add column if not exists last_failed_at timestamptz;
alter table fitness_integrations add column if not exists last_sync_duration_ms integer;
alter table fitness_integrations add column if not exists syncing_since timestamptz;
