-- Home Management pillar. Run once, after 005_finance.sql.
-- First SHARED data in the app: a household spans both auth users, so RLS
-- moves from owner-only to membership-based for these tables.

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  user_id uuid references auth.users on delete set null, -- null = person without an account
  name text not null,
  initial text not null,
  color text not null default '#d97706',
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);
create index if not exists household_members_user_idx on household_members (user_id);
create index if not exists household_members_household_idx on household_members (household_id);

-- SECURITY DEFINER avoids RLS self-recursion on household_members — the
-- standard Supabase membership pattern.
create or replace function is_household_member(hid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- Every policy below is drop-then-create so this file is safe to re-run —
-- bare `create policy` aborts the whole script on "already exists" if the
-- migration was ever partially applied, silently leaving later policies missing.
alter table households enable row level security;
drop policy if exists "members read households" on households;
-- `or created_by = auth.uid()` matters: Postgres filters INSERT...RETURNING
-- through the SELECT policy, and the creator's household_members row (which
-- is_household_member checks) doesn't exist until the *next* statement —
-- without this, `.insert(...).select()` fails RLS on its own RETURNING.
create policy "members read households" on households
  for select using (is_household_member(id) or created_by = auth.uid());
drop policy if exists "creator inserts household" on households;
create policy "creator inserts household" on households
  for insert with check (created_by = auth.uid());
drop policy if exists "members update household" on households;
create policy "members update household" on households
  for update using (is_household_member(id));

alter table household_members enable row level security;
drop policy if exists "members read members" on household_members;
create policy "members read members" on household_members
  for select using (is_household_member(household_id));
-- Self-join (your own linked row) OR already-a-member adding others (incl. accountless people).
drop policy if exists "join or add members" on household_members;
create policy "join or add members" on household_members
  for insert with check (user_id = auth.uid() or is_household_member(household_id));
drop policy if exists "members update members" on household_members;
create policy "members update members" on household_members
  for update using (is_household_member(household_id));
drop policy if exists "members delete members" on household_members;
create policy "members delete members" on household_members
  for delete using (is_household_member(household_id));

-- ── Chores ────────────────────────────────────────────────────────────────────
create table if not exists chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  title text not null,
  description text,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly', 'one_time')),
  category text not null default 'other' check (category in (
    'kitchen','bathroom','bedroom','living','laundry','outdoor','pets','plants',
    'maintenance','errand','other'
  )),
  priority smallint not null default 3 check (priority between 1 and 4),
  estimated_minutes integer,
  recurrence text,              -- minimal RRULE subset, same as finance; anchored at anchor_date
  anchor_date date not null default current_date, -- first occurrence / due date for one_time
  assigned_member_id uuid references household_members on delete set null,
  rotate_assignment boolean not null default false, -- "alternate who cleans the bathroom"
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chores_household_idx on chores (household_id, archived_at);

create table if not exists chore_completions (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references chores on delete cascade,
  household_id uuid not null references households on delete cascade,
  member_id uuid references household_members on delete set null,
  completed_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists chore_completions_idx on chore_completions (household_id, completed_on desc);

-- ── Municipal collection schedules ────────────────────────────────────────────
create table if not exists collection_schedules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  type text not null check (type in ('garbage','recycling','compost','yard_waste','bulk','hazardous')),
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  frequency text not null default 'weekly' check (frequency in ('weekly','biweekly','monthly')),
  anchor_date date not null default current_date, -- resolves biweekly parity / monthly week-of
  bin_label text,
  notes text,
  reminder_night_before boolean not null default true,
  unique (household_id, type)
);

-- ── Shopping ──────────────────────────────────────────────────────────────────
create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references shopping_lists on delete cascade,
  household_id uuid not null references households on delete cascade,
  name text not null,
  quantity text,                -- free text: "2 cartons", "500g" — normalizing units buys nothing
  category text not null default 'other' check (category in (
    'produce','bakery','dairy','frozen','meat','seafood','pantry','snacks','drinks',
    'cleaning','toiletries','pets','other'
  )),
  priority smallint not null default 2 check (priority between 1 and 3),
  note text,
  added_by_member_id uuid references household_members on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shopping_items_list_idx on shopping_items (list_id, completed_at);

-- One membership-based policy shape for every household-scoped table.
alter table chores enable row level security;
drop policy if exists "household chores" on chores;
create policy "household chores" on chores
  for all using (is_household_member(household_id)) with check (is_household_member(household_id));

alter table chore_completions enable row level security;
drop policy if exists "household completions" on chore_completions;
create policy "household completions" on chore_completions
  for all using (is_household_member(household_id)) with check (is_household_member(household_id));

alter table collection_schedules enable row level security;
drop policy if exists "household collections" on collection_schedules;
create policy "household collections" on collection_schedules
  for all using (is_household_member(household_id)) with check (is_household_member(household_id));

alter table shopping_lists enable row level security;
drop policy if exists "household lists" on shopping_lists;
create policy "household lists" on shopping_lists
  for all using (is_household_member(household_id)) with check (is_household_member(household_id));

alter table shopping_items enable row level security;
drop policy if exists "household items" on shopping_items;
create policy "household items" on shopping_items
  for all using (is_household_member(household_id)) with check (is_household_member(household_id));

-- ── Widen insights domain enum to include home ────────────────────────────────
alter table insights drop constraint if exists insights_domain_check;
alter table insights add constraint insights_domain_check
  check (domain in ('fitness','nutrition','calendar','tasks','sleep','finance','home'));
