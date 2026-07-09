-- Phase 1: Life Command Center. Additive only — run once, after schema.sql.
-- (schema.sql's bare `create policy` statements aren't re-runnable, so Phase 1
-- changes live in their own file rather than editing schema.sql in place.)

-- ── Memory upgrades: confidence, usage tracking, edit timestamp ──────────────
alter table memories add column if not exists confidence smallint not null default 5 check (confidence between 1 and 5);
alter table memories add column if not exists usage_count integer not null default 0;
alter table memories add column if not exists updated_at timestamptz not null default now();

-- ── Onboarding gate ───────────────────────────────────────────────────────────
alter table profiles add column if not exists onboarded_at timestamptz;

-- Widen match_memories to return everything the app-side ranking function
-- (importance + recency + usage, on top of similarity) needs, and widen the
-- candidate pool it searches — final top-N selection now happens in JS so
-- the weighting is unit-testable without a live database.
-- Postgres won't let CREATE OR REPLACE change a function's return columns,
-- so the old 4-column version must be dropped first.
drop function if exists match_memories(uuid, vector, float, int);

create or replace function match_memories(
  p_user_id uuid,
  p_embedding vector(768),
  p_threshold float default 0.55,
  p_count int default 20
) returns table (
  id uuid, kind text, content text, similarity float,
  importance smallint, usage_count integer, last_used_at timestamptz, created_at timestamptz
)
language sql stable as $$
  select m.id, m.kind, m.content, 1 - (m.embedding <=> p_embedding) as similarity,
         m.importance, m.usage_count, m.last_used_at, m.created_at
  from memories m
  where m.user_id = p_user_id
    and m.embedding is not null
    and 1 - (m.embedding <=> p_embedding) > p_threshold
  order by m.embedding <=> p_embedding
  limit p_count;
$$;

create or replace function increment_memory_usage(p_id uuid)
returns void language sql as $$
  update memories set usage_count = usage_count + 1 where id = p_id;
$$;

-- ── Insights ──────────────────────────────────────────────────────────────────
create table if not exists insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  domain text not null check (domain in ('fitness', 'nutrition', 'calendar', 'tasks', 'sleep')),
  message text not null,
  reason text not null, -- plain-language explanation of why this fired, shown in the UI
  importance smallint not null default 3 check (importance between 1 and 5),
  dedup_key text not null, -- stable per (user, condition, day) — prevents duplicate insight spam
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  dismissed_at timestamptz,
  acted_on boolean not null default false,
  unique (user_id, dedup_key)
);
create index if not exists insights_active_idx on insights (user_id, dismissed_at, importance desc, created_at desc);

alter table insights enable row level security;
create policy "own insights" on insights for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Reminders ─────────────────────────────────────────────────────────────────
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  linked_table text check (linked_table in ('tasks', 'workouts', 'meals')),
  linked_id uuid,
  message text not null,
  remind_at timestamptz not null,
  notification_type text not null default 'in_app' check (notification_type in ('in_app', 'email', 'push')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_due_idx on reminders (user_id, completed_at, remind_at);

alter table reminders enable row level security;
create policy "own reminders" on reminders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
