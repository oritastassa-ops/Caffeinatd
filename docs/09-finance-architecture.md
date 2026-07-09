# Financial Intelligence — Architecture Package (Phase: Finance)

Status: **awaiting approval — no implementation yet**, per the phase brief.

Grounded in the current codebase as of this writing: coffee design system (`globals.css` tokens,
`card-enter`, steam loader), `insights` table with a domain check constraint, `profiles.settings`
jsonb (weightUnit / trainingProgramId / fitnessGoals already live there), the Zod-tool pipeline,
the deterministic-math-first convention (`lib/fitness/*` as the model), and the
`fitness_integrations` pattern for third-party providers.

---

## 1. Product specification

Finance becomes the sixth pillar: not accounting, but an AI coach over four object types the user
maintains — **accounts** (assets/liabilities), **transactions** (income/expenses), **goals**, and
**snapshots** (computed history). Everything else — net worth, savings rate, forecasts, health
score, what-if answers — is *derived deterministically* from those four, never stored as a second
source of truth (same philosophy as PR detection: improve the math later without stale data
disagreeing).

**Core loops:**
- *Capture*: "I spent $40 on groceries" / "I got paid $2,800" via ⌘K → typed rows, undoable, same
  as every other pillar. Manual forms on the Finance page as the no-AI fallback (a lesson from the
  review doc: every pillar needs manual CRUD parity).
- *Glance*: Finance dashboard answers "where is my money / where is it going / am I improving" in
  one screen of cards.
- *Coach*: assistant answers "can I afford X" / "when can I buy a car" with real computed numbers
  via a `get_finance_report` tool + a `simulate_finances` tool (the What-If engine exposed to the
  LLM), explaining reasoning rather than just answering.
- *Proact*: finance rules join the existing insight engine; a weekly review lands via the existing
  cron.

**Explicitly out of scope this phase:** live bank/brokerage connections (Plaid etc. — architecture
reserved, §7), active trading anything, per-holding portfolio tracking (accounts have a value and
an allocation label, not individual positions), multi-currency.

## 2. Database schema (migration `005_finance.sql`, additive)

```sql
finance_accounts (
  id uuid pk, user_id fk,
  name text,                       -- "Wealthsimple TFSA", "Visa"
  kind text check in ('cash','checking','savings','tfsa','fhsa','rrsp','brokerage',
                      'crypto','vehicle','property','other_asset',
                      'credit_card','student_loan','mortgage','car_loan','other_debt'),
  side text generated: asset|liability (derived from kind, stored for query ergonomics),
  balance numeric(12,2),           -- current value; positive numbers for both sides
  expected_return_pct numeric(5,2),-- optional, for investment growth projection
  allocation text,                 -- optional free label: "ETF", "GIC", "BTC"
  archived_at, created_at, updated_at
)

finance_transactions (
  id uuid pk, user_id fk,
  direction text check in ('income','expense'),
  amount numeric(12,2) check > 0,
  category text check in ('housing','food','transportation','health','entertainment',
                          'education','subscriptions','travel','shopping','utilities',
                          'savings','investments','salary','freelance','scholarship',
                          'business','dividends','gift','other'),
  description text,
  occurred_on date,
  account_id fk nullable,          -- which account it hit, if the user says
  recurrence text nullable,        -- RRULE, same convention as tasks
  recurrence_id uuid nullable,     -- rows materialized from a recurring template point back
  created_at
)

finance_goals (
  id uuid pk, user_id fk,
  title, description,
  target_amount numeric(12,2), current_amount numeric(12,2) default 0,
  linked_account_id fk nullable,   -- goal funded by an account → current_amount tracks its balance
  monthly_contribution numeric(10,2),
  priority smallint 1-5, deadline date nullable,
  achieved_at, created_at, updated_at
)

finance_snapshots (
  user_id fk, snapshot_date date, pk (user_id, snapshot_date),
  net_worth numeric(12,2), assets numeric(12,2), liabilities numeric(12,2),
  created_at
)                                   -- written by cron daily; history for growth charts
```

RLS owner-only on all four (existing pattern). `insights.domain` check constraint gains
`'finance'` (drop + re-add constraint — the one non-purely-additive change, still safe).
Weekly review is stored in the existing `daily_plans`-like pattern: a `finance_reviews(user_id,
week_start, review jsonb)` table, one row per week, LLM-phrased from deterministic numbers.

**Not stored:** health score, savings rate, forecasts, monthly changes — all computed on read
from the four core tables (cheap at this scale, always consistent).

## 3. UI wireframes (descriptions)

**`/finance` (dashboard)** — order: (1) hero card: Net Worth with monthly/yearly delta and a
minimal SVG sparkline from snapshots; (2) glance row of 4 stat cards: Cash Available (sum of
liquid-kind assets), Spending This Month, Savings Rate, Financial Health Score (tap →
explanation drawer listing every factor, same pattern as the readiness card); (3) Goals card:
progress bars with ETA ("Emergency fund — 64%, done ~March"); (4) Upcoming card: recurring
expenses/income due in the next 14 days (from RRULEs); (5) Smart Suggestions (existing insights
card filtered to finance domain); (6) recent transactions list with quick-add form.

**`/finance/simulator`** — two tabs. *What-If*: sliders for Δmonthly savings, Δincome, Δexpenses,
one-time purchase amount, expected return; instant recalcs of goal ETAs, 12-month cash curve, and
health score with before→after deltas. *Compound Interest*: initial / monthly / years / return /
inflation sliders, clean area chart (contributions vs. growth split), future value in real and
nominal terms. Both are pure client-side math over data fetched once — instant, no server round
trips per slider move.

**`/finance/accounts`** — asset and liability sections, inline balance editing (a balance edit is
the manual "sync"), archive. Adding/editing writes a snapshot for today so charts update.

Empty states follow the coffee voice ("Your money's first coffee chat ☕ — add an account or tell
me what you spent today").

## 4. Navigation changes

Sidebar: `Finance` pillar with `$`-style glyph between Nutrition and Memory. Today page: one
finance glance card (health score + this month's spending vs. income) added to the dashboard
card set, honoring the existing dashboard-customization dropdown. Command-bar suggestion chips
gain "Log an expense" / "Can I afford…".

## 5. AI integration plan

Five new Zod tools (existing single-source-of-truth pattern): `log_expense`, `log_income`
(both undoable-receipt style), `create_finance_goal`, `get_finance_report` (read-only digest:
net worth, cash, savings rate 3-month trend, goal ETAs, health score with factors — the numbers
the model must never guess), and `simulate_finances` (parameters = the What-If deltas; returns the
deterministic engine's before/after so the model can *explain* trade-offs, not compute them).
System-prompt rules extended: money questions ("can I afford", "what if", "when can I") must call
`get_finance_report`/`simulate_finances` first. Finance insight rules (deterministic, existing
engine): spending-category month-over-month change ≥15%, savings-rate streak, emergency-fund
months-of-expenses milestone, goal-ahead/behind-schedule, upcoming large recurring bill vs. cash
available. Weekly review: cron (existing daily route checks "is it Monday in user tz") assembles
deterministic week numbers → one LLM call phrases the narrative → stored in `finance_reviews`,
surfaced on the dashboard.

## 6. Financial calculation engine (`lib/finance/`, all pure, all unit-tested)

- `networth.ts` — sum assets − liabilities; deltas vs. snapshot history.
- `cashflow.ts` — monthly income/expense aggregation, category breakdown, savings rate; expands
  RRULEs for "upcoming" (reusing the recurrence convention, not a new engine).
- `forecast.ts` — goal ETA: months = remaining ÷ monthly contribution, with linked-account
  compound growth when `expected_return_pct` is set; sensitivity ("+$200/mo → 4 months sooner").
- `compound.ts` — future value with monthly contributions, real vs. nominal (inflation-adjusted),
  contribution/interest split series for the chart.
- `health.ts` — 0–100 score, weighted factors each with a plain-language reason string (exact
  same explainability contract as `readiness.ts`): emergency-fund months (25), savings rate (25),
  debt-to-asset ratio (20), goal progress vs. plan (15), contribution consistency (15).
- `simulate.ts` — takes current state + a `WhatIfDelta`, returns full recomputed projection; both
  the simulator UI and the `simulate_finances` tool call this one function.

AI is used for exactly two things: phrasing (weekly review, coaching answers) and judgment
(prioritization advice) — never arithmetic, per the brief and the house convention.

## 7. Future integration architecture

Mirror the proven fitness pattern exactly: a `finance_integrations` table (provider check
constraint widened per provider, encrypted credentials via the existing `lib/integrations/crypto`,
sync lock, status fields) + `lib/integrations/<provider>/` modules implementing a
`FinanceProviderClient` interface (`testConnection`, `sync`) registered in the existing registry
file. Imported transactions/balances land in the same four core tables with `source` +
`provider_ref` columns (added in this phase's migration, defaulted to `'manual'`, so provider
work later is purely additive). CSV import becomes just another "provider." None of this is built
now beyond the two columns.

## 8. Implementation roadmap

1. **M1 — Foundation**: migration 005, types, `lib/finance/` engine complete with unit tests
   (the largest single chunk of new pure math; test-first).
2. **M2 — Capture + pillar page**: tools (`log_expense`/`log_income`/`create_finance_goal`),
   executor handlers, `/finance` dashboard + accounts page, sidebar/Today integration, manual CRUD.
3. **M3 — Intelligence**: `get_finance_report` + `simulate_finances` tools, finance insight rules,
   snapshot cron step, weekly review generation + display.
4. **M4 — Simulators**: `/finance/simulator` (What-If + compound interest), client-side over
   `simulate.ts`/`compound.ts`.
5. Verification gate after each milestone: typecheck, full test suite, build (existing process).

Estimated new surface: ~1 migration, ~7 lib modules, ~6 test files, ~4 pages, ~5 tools, ~8
components. No changes to Hevy, memory, or the AI provider layer.
