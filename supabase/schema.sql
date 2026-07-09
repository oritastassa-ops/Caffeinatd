-- Caffeinatd schema. Run once in the Supabase SQL editor.
create extension if not exists vector;

-- ── Profiles ──────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default 'there',
  timezone text not null default 'UTC',
  settings jsonb not null default '{}'::jsonb, -- { calorieGoal, proteinGoal, carbsGoal, fatGoal, sleepHours, windDownMinutes }
  created_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- ── Tasks ─────────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  notes text,
  priority smallint not null default 3 check (priority between 1 and 4), -- 1 = urgent
  category text,
  project text,
  due_at timestamptz,
  recurrence text, -- RRULE, expanded by a later milestone's cron
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tasks_user_open_idx on tasks (user_id, completed_at, due_at);

-- ── Fitness ───────────────────────────────────────────────────────────────────
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  performed_on date not null default current_date,
  kind text not null default 'strength' check (kind in ('strength', 'cardio', 'mobility', 'other')),
  title text not null,
  duration_min integer,
  distance_km numeric(6, 2),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  exercise text not null,
  set_no smallint not null default 1,
  reps smallint,
  weight_kg numeric(6, 2)
);
create index if not exists sets_user_exercise_idx on workout_sets (user_id, exercise);

-- ── Nutrition ─────────────────────────────────────────────────────────────────
create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  eaten_at timestamptz not null default now(),
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  description text not null,
  calories integer,
  protein_g integer,
  carbs_g integer,
  fat_g integer,
  created_at timestamptz not null default now()
);
create index if not exists meals_user_time_idx on meals (user_id, eaten_at desc);

-- ── Memory ────────────────────────────────────────────────────────────────────
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('preference', 'habit', 'relationship', 'routine', 'goal', 'event')),
  content text not null,
  importance smallint not null default 3 check (importance between 1 and 5),
  embedding vector(768),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function match_memories(
  p_user_id uuid,
  p_embedding vector(768),
  p_threshold float default 0.55,
  p_count int default 6
) returns table (id uuid, kind text, content text, similarity float)
language sql stable as $$
  select m.id, m.kind, m.content, 1 - (m.embedding <=> p_embedding) as similarity
  from memories m
  where m.user_id = p_user_id
    and m.embedding is not null
    and 1 - (m.embedding <=> p_embedding) > p_threshold
  order by m.embedding <=> p_embedding
  limit p_count;
$$;

-- ── Daily plans ───────────────────────────────────────────────────────────────
create table if not exists daily_plans (
  user_id uuid not null references auth.users on delete cascade,
  plan_date date not null,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, plan_date)
);

-- ── Google OAuth tokens ───────────────────────────────────────────────────────
create table if not exists google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ── RLS: every table is owner-only ────────────────────────────────────────────
alter table profiles enable row level security;
alter table tasks enable row level security;
alter table workouts enable row level security;
alter table workout_sets enable row level security;
alter table meals enable row level security;
alter table memories enable row level security;
alter table daily_plans enable row level security;
alter table google_tokens enable row level security;

create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own tasks" on tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own workouts" on workouts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sets" on workout_sets for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own meals" on meals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own memories" on memories for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own plans" on daily_plans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own google tokens" on google_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());
