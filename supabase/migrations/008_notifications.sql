-- Notification substrate (Phase 1): the channel-agnostic delivery layer that
-- lets every pillar (daily plan, reminders, insights, finance, fitness) reach
-- the user off-app. Additive only — run once, after 007_workspaces.sql.
-- No message is sent by this migration; it defines where intent, destinations,
-- and the send audit trail live. Resend (Phase 2) and Twilio (Phase 3) add a
-- provider each and touch nothing here.

-- ── Contacts: a user's verified destinations ─────────────────────────────────
-- One row per (user, channel, address). `address` is stored already normalized
-- (lower-cased email / E.164 phone) so the uniqueness constraint is meaningful.
-- Only a hash of the verification code is ever stored — never the code itself.
create table if not exists notification_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  address text not null,
  label text,
  verified_at timestamptz,
  verification_code_hash text,
  verification_expires_at timestamptz,
  verification_attempts smallint not null default 0,
  -- Throttles code *requests* (resend spam), distinct from verify *attempts*.
  verification_last_sent_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, channel, address)
);
create index if not exists notification_contacts_user_idx
  on notification_contacts (user_id, channel);
-- At most one primary destination per (user, channel).
create unique index if not exists notification_contacts_primary_idx
  on notification_contacts (user_id, channel) where is_primary;

-- ── Preferences: per user, per notification kind, which channels are on ───────
-- Defaults also live in application code (src/lib/notifications/preferences.ts)
-- so enqueue is correct before any row is seeded; a row here is an override.
create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in
    ('daily_plan', 'reminder', 'insight', 'finance_review', 'fitness_nudge', 'system')),
  enabled boolean not null default true,
  channels text[] not null default '{email}',
  -- Quiet hours are stored in the user's local wall-clock time; the dispatcher
  -- (Phase 4) resolves them against profiles.timezone. Null = no quiet hours.
  quiet_hours_start time,
  quiet_hours_end time,
  digest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

-- ── Deliveries: the queue AND the audit log, one table ───────────────────────
-- A row is created 'pending' at enqueue and mutated in place through its
-- lifecycle to 'sent'/'failed'/'skipped'. Keeping the outbox and the history in
-- one table means the send worker's claim query and the "what did we send you"
-- audit are the same rows — no copy step, no drift (see docs/14).
create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in
    ('daily_plan', 'reminder', 'insight', 'finance_review', 'fitness_nudge', 'system')),
  channel text not null check (channel in ('email', 'sms')),
  contact_id uuid references notification_contacts on delete set null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);
-- Idempotency guarantee: a caller-supplied dedupe_key can fan out to one row
-- per channel, but never double-send the same (event, channel). The database,
-- not application code, enforces this — so cron retries and Vercel
-- re-invocations racing in parallel still collapse to one row. The brief's
-- (user_id, dedupe_key) is widened to include channel precisely so the same
-- logical event can reach both email and SMS.
create unique index if not exists notification_deliveries_dedupe_idx
  on notification_deliveries (user_id, dedupe_key, channel)
  where dedupe_key is not null;
-- The send worker's claim query: oldest due pending rows first.
create index if not exists notification_deliveries_claim_idx
  on notification_deliveries (status, scheduled_for);

-- ── Spend: per-user, per-channel, per-day send counters ──────────────────────
-- deliveries is the audit truth; this is the cheap counter the SMS spend cap
-- (Phase 3) reads/increments without scanning the whole delivery history. Daily
-- granularity lets a cap sum any rolling window (e.g. last 30 days).
create table if not exists notification_spend (
  user_id uuid not null references auth.users on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  period_start date not null,
  sent_count integer not null default 0,
  cost_micros bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel, period_start)
);

-- ── RLS: owner-only, drop-then-create so the file is safe to re-run ──────────
alter table notification_contacts enable row level security;
drop policy if exists "own notification contacts" on notification_contacts;
create policy "own notification contacts" on notification_contacts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notification_preferences enable row level security;
drop policy if exists "own notification preferences" on notification_preferences;
create policy "own notification preferences" on notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notification_deliveries enable row level security;
drop policy if exists "own notification deliveries" on notification_deliveries;
create policy "own notification deliveries" on notification_deliveries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notification_spend enable row level security;
drop policy if exists "own notification spend" on notification_spend;
create policy "own notification spend" on notification_spend
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
