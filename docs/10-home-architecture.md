# Home Management & Household Intelligence — Architecture Package

Status: **awaiting approval — no implementation yet**, per the phase brief.

Grounded in the current codebase: owner-only RLS on every table so far, the minimal-RRULE
recurrence engine already built and tested in `lib/finance/cashflow.ts` (reused here, not
duplicated), the Zod-tool pipeline, the `insights` engine with per-domain rules, the DailyPlan
Zod schema in `lib/planning/daily.ts`, and the coffee design system.

---

## 1. Product specification

Home is the household operating layer: **chores** (recurring + one-time, assignable, with
completion history), **collection schedules** (garbage/recycling/compost/…), **shopping lists**
(multiple, categorized, collaborative), and **members** (people, not accounts). Everything
derived — due-today, overdue, rotation, "kitchen hasn't been cleaned in 9 days", completion
rates — is computed deterministically from those four object types, never stored redundantly.

**Chores complement Tasks, they don't replace them.** A task is *my* to-do ("call mom"); a chore
is *the house's* recurring work with an assignee and a history. The assistant routes "vacuum every
Saturday" → chore, "remind me to call mom" → task; the system prompt gets an explicit routing rule.

**Core loops:** capture ("we need milk", "assign laundry to Sarah") via ⌘K with undoable receipts
plus full manual CRUD; glance (the Home dashboard answers "what does our house need today?");
coach ("what chores are overdue?" via a `get_home_report` tool); proact (collection-day and
overdue-chore insights, chores merged into the morning plan).

**Out of scope this phase, architecture reserved:** inventory tracking (§ future: an
`inventory_items` table keyed to the same household; shopping items already carry the fields it
needs), push notifications (reminders architecture from Phase 1 already has `notification_type`),
attachments on chores.

## 2. Database schema (migration `006_home.sql`)

**This is the first *shared* data in the app** — everything until now is owner-only. A household
is shared between the two real auth users; household *members* are people who may or may not have
accounts (a roommate can be assignable without ever logging in).

```sql
households (
  id uuid pk, name text, invite_code text unique default short random,
  created_by uuid fk auth.users, created_at
)

household_members (
  id uuid pk, household_id fk,
  user_id uuid fk auth.users nullable,  -- null = person without an account
  name text, initial text, color text,
  role text check in ('owner','member'),  -- permissions: owner edits schedules/members
  created_at
)

-- RLS everywhere below: is_household_member(household_id) — a SECURITY DEFINER
-- function (the standard Supabase pattern; a plain self-referential subquery on
-- household_members would recurse). One policy shape for all seven tables.

chores (
  id uuid pk, household_id fk,
  title, description,
  cadence text check in ('daily','weekly','monthly','one_time'),
  category text check in ('kitchen','bathroom','bedroom','living','laundry',
                          'outdoor','pets','plants','maintenance','errand','other'),
  priority smallint 1-4 default 3,
  estimated_minutes int nullable,
  recurrence text nullable,       -- same minimal RRULE subset as finance; anchor = anchor_date
  anchor_date date not null,      -- first occurrence / due date for one_time
  assigned_member_id fk household_members nullable,
  rotate_assignment boolean default false,  -- "alternate who cleans the bathroom"
  archived_at, created_at
)

chore_completions (
  id uuid pk, chore_id fk cascade, household_id fk,
  member_id fk household_members nullable, completed_on date, created_at
)                                  -- history powers analytics + "not cleaned in N days"

collection_schedules (
  id uuid pk, household_id fk,
  type text check in ('garbage','recycling','compost','yard_waste','bulk','hazardous'),
  day_of_week smallint 0-6, frequency text check in ('weekly','biweekly','monthly'),
  anchor_date date,               -- resolves biweekly parity / monthly week-of
  bin_label text, notes text, reminder_night_before boolean default true
)

shopping_lists (
  id uuid pk, household_id fk, name text, archived_at, created_at
)

shopping_items (
  id uuid pk, list_id fk cascade, household_id fk,
  name text, quantity text nullable,        -- "2 cartons", "500g" — text, not numeric
  category text check in ('produce','bakery','dairy','frozen','meat','seafood','pantry',
                          'snacks','drinks','cleaning','toiletries','pets','other'),
  priority smallint 1-3 default 2, note text,
  added_by_member_id fk nullable, completed_at, created_at
)
```

`insights.domain` check widens again to include `'home'`. `daily_plans` unchanged (jsonb absorbs
the new field).

## 3. Household member architecture

- First visit to `/home` with no household → a setup card: **Create household** (names it,
  creates an `owner` member linked to your user) or **Join with code** (partner enters the
  invite code shown on the creator's Home page → inserts their linked member row).
- Members without accounts are added by name from the Household settings card — fully
  assignable, shown with initial + color chips, just not able to log in.
- The AI resolves member references fuzzily in the executor ("Sarah" → ILIKE match on
  `household_members.name`), exactly like `complete_task` resolves titles today: ambiguous →
  ask, no match → say so.
- Permissions kept honest at this scale: `owner` manages members/schedules; everyone manages
  chores/shopping. Enforced in server actions, not a policy engine.

## 4. Recurring scheduling engine (`lib/home/schedule.ts`, pure, unit-tested)

Reuses `parseRecurrence`/`occurrencesBetween` from `lib/finance/cashflow.ts` (exported already —
no duplication). On top of it:

- `isDueOn(chore, date, completions)` — daily: due unless completed that day; weekly/monthly:
  due when `date` is an occurrence of its recurrence (anchored at `anchor_date`) and no
  completion covers that occurrence window; one_time: due when `anchor_date <= date` and never
  completed.
- `overdueDays(chore, today, completions)` — days since the earliest uncovered occurrence.
- `nextAssignee(chore, members, completions)` — rotation: the member after the last completer in
  member order; deterministic, no state stored.
- `daysSinceLastCompletion(category, chores, completions)` — powers "kitchen hasn't been cleaned
  in 9 days".
- `lib/home/collections.ts` — `nextCollection(schedule, today)` handling weekly / biweekly parity
  from `anchor_date` / monthly (same week-of-month as anchor), and
  `collectionStatusLine(...)` → "Garbage goes out tonight" / "Tomorrow is recycling day".

All deterministic. The LLM never computes a due date.

## 5. Shopping list architecture

Lists are rows, not hardcoded (Groceries, Costco, a one-off "Camping Trip" — same table).
Items carry `quantity` as free text ("500g", "2 cartons") because normalizing units buys nothing
here. Categorization is two-tier, mirroring the memory system's philosophy: the AI tool passes a
category (language judgment — allowed), the manual quick-add falls back to a deterministic
keyword map (`lib/home/categorize.ts`, unit-tested) so the no-AI path still groups sensibly.
Check-off sets `completed_at` (kept for "you usually shop every Sunday" analytics later);
"I bought everything" → tool completes all open items on a list. Collaborative editing falls out
of shared RLS + `router.refresh()` — no realtime channel needed at two-user scale.

## 6. Daily Plan integration

- `planSchema` in `lib/planning/daily.ts` gains `home: z.string().default("")` (old stored plans
  parse fine), and the LLM context gains a deterministic block: chores due today (with
  assignees), tonight/tomorrow collections, open-item counts on shopping lists.
- The prompt instruction for `priorities` widens to draw from household duties too — producing
  exactly the brief's example ("Take recycling out tonight" alongside meetings and workouts).
- The Today page gets a collections strip (only renders when tonight/tomorrow) and home lines
  ride the existing plan card — no new Today sections beyond a Home glance card.

## 7. AI tool definitions (Zod, existing single-source-of-truth pattern)

`add_chore` (title, cadence, category, recurrence?, assigned_to_name?, rotate?, due_date?),
`complete_chore` (title_query, completed_by_name?), `list_chores` (filter: today|overdue|all),
`add_shopping_item` (item, list_name?, quantity?, category), `check_off_shopping`
(list_name?, item_query? — omitted item = whole list, per "I bought everything"),
`remove_shopping_item` (item_query, list_name?), `set_collection_schedule` (type, day_of_week,
frequency, anchor_date?) — so "garbage day is Tuesday" is a sentence, not a settings hunt —
and `get_home_report` (read-only digest: due/overdue with assignees, next collections, list
summaries, completion stats; the model must call it before answering household questions).
System prompt gains the chore-vs-task routing rule and "household questions → get_home_report
first". Mutating tools return undoable receipts (undo whitelist gains the three new tables).

## 8. UI wireframes

**`/home` (dashboard)** — (1) household setup card (only when no household) or a collections
strip ("🗑 Garbage goes out tonight"); (2) **Today's chores**: satisfying check-list, each row
title + assignee chip + category icon, checking writes a completion (with rotation, the next
assignee appears immediately); (3) **Overdue** (only when nonempty, days-overdue labels);
(4) glance row: completed this week / completion rate this month / most active member / open
shopping items; (5) **Shopping preview**: per-list open counts linking to `/home/shopping`;
(6) **Upcoming**: next 7 days of chores + collections; (7) recent household activity (last
completions with member initials).

**`/home/shopping`** — list switcher chips + add-list; items grouped by category with icons,
big tap targets, checked items sink to a collapsed "in your cart" section; quick-add input with
keyword auto-categorization; "Clear completed".

**`/home/household`** — members (add/edit name/color/role, remove), collection schedule
editor (type, day, frequency dropdowns), invite code with copy button.

Empty states in the coffee voice ("A tidy home starts with one chore ☕").

## 9. Navigation changes

Sidebar: `Home` (icon `⌂`) directly after Today — it's a daily-glance pillar, not an archive.
Today page: Home glance card in the existing glance row (headline: chores due today, accent when
zero). Command bar suggestions: "We need milk", "What housework do I have today?".

## 10. Implementation roadmap

- **M1 — Foundation**: migration 006 (+ `is_household_member` security-definer fn), types,
  household create/join/members plumbing + `/home/household` page.
- **M2 — Engine**: `lib/home/schedule.ts`, `collections.ts`, `categorize.ts` + full unit tests
  (the due/rotation/parity math is the risk surface — test-first).
- **M3 — Surfaces**: `/home` dashboard + `/home/shopping`, server actions, sidebar/Today
  integration.
- **M4 — Intelligence**: the 8 tools + executor handlers + routing rules, home insight rules
  (collection tomorrow, overdue pileup, stale category, weekly completion milestone), daily-plan
  `home` field + context block, `get_home_report`.
- Verification gate after each milestone: typecheck, full test suite, build.

Estimated surface: 1 migration, 3 engine modules + ~4 test files, 3 pages, ~6 components,
8 tools. No changes to Hevy, Finance, memory, or the provider layer.
