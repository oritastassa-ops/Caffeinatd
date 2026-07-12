-- Workspaces pillar: first-class contexts (Development, University, Research…)
-- plus the primitives every context surfaces: notes, quick captures, and
-- persisted AI conversations. Run once, after 006_home.sql.
-- All tables here are personal (owner-only RLS), unlike the Home pillar.

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  slug text not null,
  name text not null,
  kind text not null default 'custom'
    check (kind in ('development', 'university', 'premed', 'research', 'personal', 'fitness', 'custom')),
  icon text not null default '◈', -- glyph shown in nav; matches the sidebar's glyph style
  description text,
  sort_order smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);
create index if not exists workspaces_user_idx on workspaces (user_id, sort_order);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references workspaces on delete set null,
  title text not null default '',
  content text not null default '', -- markdown
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_recent_idx on notes (user_id, updated_at desc);
create index if not exists notes_workspace_idx on notes (workspace_id);

-- Quick Capture inbox: one natural-language line, triaged later (by the user
-- or, in a later phase, by the assistant pipeline).
create table if not exists captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references workspaces on delete set null,
  content text not null,
  status text not null default 'inbox' check (status in ('inbox', 'processed', 'dismissed')),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists captures_user_inbox_idx on captures (user_id, status, created_at desc);

-- Assistant exchanges, persisted so "Recent conversations" and search work.
-- messages: [{ role: 'user' | 'assistant', content: string, at: ISO }]
create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references workspaces on delete set null,
  title text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_recent_idx on ai_conversations (user_id, updated_at desc);

-- Tasks join the workspace system; null = unscoped (today's global lists).
alter table tasks add column if not exists workspace_id uuid references workspaces on delete set null;
create index if not exists tasks_workspace_idx on tasks (workspace_id);

-- ── RLS: owner-only, drop-then-create so the file is safe to re-run ──────────
alter table workspaces enable row level security;
drop policy if exists "own workspaces" on workspaces;
create policy "own workspaces" on workspaces
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notes enable row level security;
drop policy if exists "own notes" on notes;
create policy "own notes" on notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table captures enable row level security;
drop policy if exists "own captures" on captures;
create policy "own captures" on captures
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table ai_conversations enable row level security;
drop policy if exists "own ai conversations" on ai_conversations;
create policy "own ai conversations" on ai_conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
