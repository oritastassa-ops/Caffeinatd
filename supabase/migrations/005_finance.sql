-- Financial Intelligence pillar. Additive except one widened check constraint.
-- Run once, after 004_fitness_intelligence.sql.

-- ── Accounts: assets and liabilities ─────────────────────────────────────────
create table if not exists finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  kind text not null check (kind in (
    'cash','checking','savings','tfsa','fhsa','rrsp','brokerage','crypto',
    'vehicle','property','other_asset',
    'credit_card','student_loan','mortgage','car_loan','other_debt'
  )),
  -- Derived from kind; stored so queries don't need the kind→side mapping.
  side text not null check (side in ('asset','liability')),
  balance numeric(12,2) not null default 0 check (balance >= 0), -- positive for both sides
  expected_return_pct numeric(5,2), -- optional; enables compound growth in forecasts
  allocation text,                  -- free label: "ETF", "GIC", "BTC"
  source text not null default 'manual', -- future providers (Plaid/CSV) are purely additive
  provider_ref text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table finance_accounts enable row level security;
create policy "own finance accounts" on finance_accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Transactions: income and expenses ────────────────────────────────────────
create table if not exists finance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  direction text not null check (direction in ('income','expense')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null check (category in (
    'housing','food','transportation','health','entertainment','education',
    'subscriptions','travel','shopping','utilities','savings','investments',
    'salary','freelance','scholarship','business','dividends','gift','other'
  )),
  description text not null,
  occurred_on date not null default current_date,
  account_id uuid references finance_accounts on delete set null,
  recurrence text,        -- minimal RRULE subset: FREQ=WEEKLY|MONTHLY|YEARLY[;INTERVAL=n]
  recurrence_id uuid references finance_transactions on delete set null, -- materialized child → template
  source text not null default 'manual',
  provider_ref text,
  created_at timestamptz not null default now()
);
create index if not exists finance_tx_user_date_idx on finance_transactions (user_id, occurred_on desc);
alter table finance_transactions enable row level security;
create policy "own finance transactions" on finance_transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Goals ─────────────────────────────────────────────────────────────────────
create table if not exists finance_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  description text,
  target_amount numeric(12,2) not null check (target_amount > 0),
  current_amount numeric(12,2) not null default 0,
  linked_account_id uuid references finance_accounts on delete set null, -- goal tracks that account's balance
  monthly_contribution numeric(10,2) not null default 0,
  priority smallint not null default 3 check (priority between 1 and 5),
  deadline date,
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table finance_goals enable row level security;
create policy "own finance goals" on finance_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Net-worth snapshots: computed history for growth charts ──────────────────
create table if not exists finance_snapshots (
  user_id uuid not null references auth.users on delete cascade,
  snapshot_date date not null,
  net_worth numeric(12,2) not null,
  assets numeric(12,2) not null,
  liabilities numeric(12,2) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);
alter table finance_snapshots enable row level security;
create policy "own finance snapshots" on finance_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Weekly reviews: deterministic numbers, LLM-phrased narrative ─────────────
create table if not exists finance_reviews (
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,
  review jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table finance_reviews enable row level security;
create policy "own finance reviews" on finance_reviews
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Widen the insights domain enum to include finance ────────────────────────
alter table insights drop constraint if exists insights_domain_check;
alter table insights add constraint insights_domain_check
  check (domain in ('fitness','nutrition','calendar','tasks','sleep','finance'));
