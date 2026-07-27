# Phase 4 — Scheduling, dispatch, and assistant tools

Requires Phase 1 and at least one of Phase 2 / Phase 3.

## Goal

Connect everything that already knows something to the channel that can say it, and give the
assistant the vocabulary to schedule its own follow-ups. This is where Caffeinatd stops being a
dashboard and starts behaving like a secretary.

Two halves: **deterministic dispatch** (reminders, pillar events, quiet-hour math) and
**assistant-driven scheduling** (new Zod tools).

## Part A — Deterministic dispatch

### 1. Quiet hours and send-window math — `src/lib/notifications/schedule.ts`

Pure functions, no I/O, fully unit-tested. This is the part most likely to be subtly wrong.

- `resolveSendTime(desiredAt, prefs, timezone): { sendAt: Date; deferred: boolean }` — if the
  desired time falls inside quiet hours, push to the window's end in the user's local time.
- Quiet windows that cross midnight (22:00–08:00) are the common case. Handle them explicitly.
- DST transitions: a window ending at 08:00 local must resolve correctly on the days that have
  23 or 25 hours. Test both directions. Do not do date math by adding milliseconds to a UTC
  timestamp and hoping; use the user's `timezone` from `profiles` (see
  `src/lib/planning/daily.ts` and `src/lib/finance/review.ts` for existing timezone handling —
  reuse rather than re-derive).
- Urgent kinds bypass quiet hours; define which kinds qualify in one place, not per call site.

### 2. Reminder dispatch

`reminders` has existed since `supabase/migrations/002_phase1.sql:67` with `remind_at`,
`notification_type`, and `completed_at`, and has never been dispatched. Wire it up.

New cron route or an extension of the Phase 2 worker — **prefer extending the existing worker**
over adding a second cron; one queue drainer is easier to reason about than two. Run every 5
minutes; a reminder is due when `remind_at <= now()` and `completed_at is null` and no delivery
row exists for it yet.

`dedupeKey`: `reminder:${reminder.id}`. That single key makes the whole loop idempotent
regardless of cron overlap.

Migrate `reminders.notification_type` semantics: it currently constrains to
`'in_app' | 'email' | 'push'`. Either widen the check constraint to include `'sms'` in migration
`009`, or — better — deprecate the column in favor of the Phase 1 preferences system and keep it
only for `in_app`. Pick one, justify it, and don't leave two sources of truth.

### 3. Pillar hooks

Enqueue from the places that already compute something worth knowing. Each call is guarded so a
notification failure never breaks the pillar:

| Source | Kind | Dedupe key |
|---|---|---|
| `generateDailyPlan` success (already wired in Phase 2) | `daily_plan` | `daily_plan:${userId}:${planDate}` |
| `ensureInsights` producing a *new* insight (`src/lib/insights/generate.ts:239` — currently returns `void`; you will need it to report what it created) | `insight` | `insight:${insight.id}` |
| `generateWeeklyReview` | `finance_review` | `finance_review:${userId}:${weekStart}` |
| Missed-workout / consistency break in `src/lib/fitness/` | `fitness_nudge` | `fitness_nudge:${userId}:${date}` |

Only new insights notify — re-running `ensureInsights` must not re-notify. The dedupe key on the
insight id handles this, but verify the insight id is stable across regeneration; if it isn't,
key on content hash instead and say so.

**Digest batching.** A user with five insights, a plan, and two reminders should not get eight
messages. When `notification_preferences.digest` is true for a kind, coalesce that kind's pending
deliveries within a window into one message. Implement this for email at minimum — for SMS it is
close to mandatory given per-message cost. If the batching design gets complicated, ship the
simple version (group by user + kind + day) and document the limitation rather than
over-engineering.

## Part B — Assistant tools

### 4. Extend the Zod catalog — `src/lib/pipeline/tools.ts`

Read that file first. Every schema is the single source of truth: it validates LLM arguments at
runtime *and* generates the function-calling contract via `z.toJSONSchema`. Follow the existing
style exactly — `.describe()` on every field the model must reason about, tight enums, no
free-form strings where a union will do.

Add:

- **`schedule_reminder`** — `{ message, remind_at (ISO 8601 with offset), channel? ('auto' | 'email' | 'sms' | 'in_app'), urgent? }`. Default `channel: 'auto'` and let preferences decide;
  models are bad at choosing channels and will over-pick SMS if you let them.
- **`cancel_reminder`** — `{ query }`, matching the `complete_task` pattern of finding by title
  words rather than requiring an id the model cannot know.
- **`list_reminders`** — `{ include_completed? }`.
- **`notify_me`** — send something now (or at a stated time) that isn't a reminder: "text me the
  gym summary after my workout." Constrain it hard; this is the tool most likely to be abused
  into a spam loop. Rate-limit per conversation.

### 5. Executor — `src/lib/pipeline/executor.ts`

Implement each tool. Read `docs/12-quality-audit.md` §A3 first: `complete_task` currently ignores
its update `error` and returns a success receipt regardless. **Fix that bug** and do not
reproduce the pattern. Every new handler checks `error` and returns a failure the pipeline can
surface.

Receipts follow the existing undoable-receipt convention — scheduling a reminder must be
undoable through `/api/assistant/undo` like every other mutation.

### 6. Failure surfacing

`docs/12-quality-audit.md` §A4 notes that `AssistantResponse` has no `failures` field, so a model
can claim success after a failed write and the UI cannot tell. Add deterministic failure
reporting: collect tool failures in `runAssistant` (`src/lib/pipeline/run.ts`), attach them to the
response, and render them as failure chips in `src/components/assistant/` alongside the existing
`ReceiptChips`.

This is a prerequisite for trusting notifications. "I texted you" when nothing sent is the worst
possible failure mode for a secretary.

## Tests

- `resolveSendTime`: inside window, outside window, crossing midnight, both DST directions,
  urgent bypass.
- Reminder dispatch: due/not-due selection, idempotency across two consecutive worker runs.
- Digest batching: N pending → 1 message, and the message contains all N items.
- New tool schemas: valid args parse, invalid args produce the validation errors the pipeline
  feeds back to the model (see how existing tool tests in `tests/tools.test.ts` are written).
- Executor: a failed insert produces a failure, not a success receipt.

## Out of scope

New channels. UI settings (Phase 5). Inbound replies.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- "Remind me to call the lab at 4pm tomorrow" through ⌘K produces a reminder that actually
  delivers, with an undoable receipt.
- A reminder scheduled inside quiet hours is deferred to the window's end, not dropped.
- Running the worker twice sends nothing twice.
- Quality-audit bugs A3 and A4 are fixed, with tests.
- One commit, imperative message.

Plan first. The digest-batching design and the `reminders.notification_type` deprecation are the
two decisions I'm least sure about — give me your recommendation with reasoning before
implementing either.
