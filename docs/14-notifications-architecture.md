# Caffeinatd — Notification Architecture (Phase 1: the substrate)

Caffeinatd could already decide what you should know — the daily plan, reminders, insights, the
finance review, missed workouts — but every one of those dead-ended at a page you had to open.
`reminders.notification_type` has accepted `'in_app' | 'email' | 'push'` since
`supabase/migrations/002_phase1.sql:74` and nothing ever dispatched one. This layer closes that
gap. Phase 1 builds the channel-agnostic substrate only: **no message is sent yet.** By the end
the system can record what should be delivered, to whom, on which channel, and whether the
destination is verified, with a `LoggingChannel` proving the path end to end.

## Why a substrate before channels

The whole point of doing this in a separate phase is that Phase 2 (Resend/email) and Phase 3
(Twilio/SMS) should each be *one file plus one registry entry* and touch nothing else. That is
the same bet the codebase already made twice and won:

- `AIProvider` + `createProvider()` (`src/lib/ai/index.ts:60`) — the pipeline sees
  `AIProvider { chat(), embed?() }` and never branches on Gemini vs Anthropic.
- `integrationRegistry` (`src/lib/integrations/registry.ts:10`) — adding Garmin/Strava is one
  entry plus one folder.

`NotificationChannel` (`src/lib/notifications/types.ts`) is the third instance. Callers —
`enqueueNotification`, the Phase 4 dispatcher, every pillar — depend only on that interface.
`channelRegistry` (`src/lib/notifications/registry.ts`) maps a channel name to a live
implementation, built from env exactly the way `createProvider()` is; a channel with no configured
credentials is simply **absent** from the map, so callers check presence (`getChannel(name) !==
null`) rather than catching construction errors.

## Data model

Four tables in `supabase/migrations/008_notifications.sql`, all owner-only RLS matching the
`user_id = auth.uid()` pattern used everywhere else.

- **`notification_contacts`** — a user's destinations, one row per `(user, channel, address)`.
  The address is stored already normalized (lower-cased email / E.164 phone) so the uniqueness
  constraint means something. Only a **hash** of the verification code is stored, never the code.
- **`notification_preferences`** — per user, per kind, which channels are on, plus quiet hours and
  a digest flag. Defaults also live in code (see below), so a row here is an *override*.
- **`notification_deliveries`** — the queue and the audit log, one table (see below).
- **`notification_spend`** — per-user, per-channel, per-day send counters, defined now so the SMS
  spend cap in Phase 3 doesn't bolt on a new table later.

### Why the queue and the audit log are one table

A delivery has exactly one lifecycle: `pending → sending → {sent | failed | skipped}`. The
"outbox" (what still needs sending) and the "history" (what we sent you, and what went wrong) are
the *same rows* at different points in that lifecycle — a `pending` row is the worker's input, and
the identical row, mutated in place to `sent` with a `provider_message_id`, is the audit record.

Splitting them into an `outbox` table and a `log` table would buy nothing and cost a copy step
that can partially fail: send succeeds, the copy-to-log write fails, and now the truth is split
across two tables with no transaction spanning them. One table means the worker's claim query
(`where status = 'pending' and scheduled_for <= now()`, served by
`notification_deliveries_claim_idx`) and the "what did we send you" audit read hit the same rows,
and a row can never exist in one place but not the other. The cost is that the table grows without
bound — addressed under *What breaks first at scale*.

### Why dedupe lives in a unique index, not application code

The idempotency requirement (README multi-tenancy note #3) is that cron retries, Vercel
re-invocations, and user-triggered sends must never double-send. The obvious application-code
version — "SELECT to check if it exists, then INSERT if not" — is a textbook race: two cron
invocations (or two serverless instances) both SELECT empty, both INSERT, both send.

`notification_deliveries_dedupe_idx` — `unique (user_id, dedupe_key, channel) where dedupe_key is
not null` — pushes the guarantee into Postgres, where it is atomic under concurrency. Two racing
inserts with the same key: one wins, the other gets SQLSTATE `23505`, which `enqueueNotification`
(`src/lib/notifications/enqueue.ts`) catches *specifically* and treats as success ("already
queued"), distinct from every other error, which propagates.

**Deviation from the brief, on purpose.** The brief specified `unique (user_id, dedupe_key)`. That
contradicts its own "one row per channel" fan-out: a single logical event (one reminder) should be
able to reach both email *and* SMS, which is two rows sharing a `dedupe_key`. A per-user-unique key
makes that impossible. Adding `channel` to the index keeps the exact idempotency guarantee — the
same event never double-sends on the same channel — while letting one event fan out across
channels. This is the one place the spec was internally inconsistent; the wider index resolves it.

### Why defaults live in code, not only in a seed

`resolvePreference` (`src/lib/notifications/preferences.ts`) merges a user's stored rows over
code-defined defaults (everything on, email-only, no quiet hours). `seedDefaultPreferences` exists
for the settings UI, but `enqueueNotification` never depends on it having run: a brand-new account,
or one where the seed lost a race, still resolves to correct defaults instead of silently going
dark. The seed uses `ignoreDuplicates` precisely so concurrent callers don't error. This mirrors
the seed-on-first-visit approach in `src/lib/workspaces/data.ts:15` but treats the seed as an
optimization, not a correctness dependency.

## Enqueue: the one function every pillar calls

`enqueueNotification(supabase, { userId, kind, payload, dedupeKey?, scheduledFor? })` resolves
preferences → verified contacts → one `pending` delivery row per channel. The decision logic
(`planDeliveries`) is a **pure function**: it gates on exactly two things — the kind is enabled for
a channel, and that channel has a verified contact — and returns the deliveries plus a `skipped[]`
of human-readable reasons. Everything hard to get right (skip unverified, skip disabled, pick the
primary-then-most-recent contact) is unit-tested without a database.

Whether a *vendor* is configured is deliberately **not** an enqueue gate. That is a send-time
concern for the Phase 4 worker. Keeping it out of enqueue means the queue is a faithful record of
intent even for a channel whose provider isn't wired yet, and it keeps `enqueueNotification`
decoupled from env and the registry — trivially testable. (Verification-code sends are the
exception: those are immediate, so `startVerification` *does* require a configured channel.)

Every Supabase call in this module reads `error` and propagates it — the repo's highest-value rule
(`docs/12-quality-audit.md` §A, the fake-success pipeline). The single intentional swallow is the
`23505` dedupe conflict described above.

## Verification

`src/lib/notifications/verification.ts`, shared by email and SMS. A 6-digit CSPRNG code
(`crypto.randomInt`, unbiased), 10-minute expiry, 5 attempts then the code is dead and must be
re-requested, and a 1-per-minute cooldown on code *requests* (distinct from verify *attempts*,
tracked in `verification_last_sent_at`). The `checkCode` verdict is pure and rejects an
exhausted-or-expired code *before* comparing the hash, so a dead code can't be brute-forced past
its budget. Sending the code goes through the channel abstraction, so it works unchanged the moment
Phases 2/3 land.

### Why HMAC-SHA256, not bare SHA-256 or bcrypt

A 6-digit code is a 10^6 space. A plain SHA-256 hash of it is brute-forced in milliseconds if the
database leaks — the salt-free fast hash buys nothing against a 1M-entry dictionary. We hash with
**HMAC-SHA256 keyed by a server secret** (`NOTIFICATION_SECRET`, falling back to `ENCRYPTION_KEY`)
the database does not contain, so a DB-only compromise can't reverse a code. We deliberately do
*not* reach for a slow KDF (bcrypt/scrypt): the 5-attempt + 10-minute limits already defeat *online*
guessing, and a fast keyed hash keeps the verify path cheap. The residual risk — an attacker with
both the DB *and* the app secret is back to brute-forcing 10^6 — is acceptable for a
short-lived, single-use code and is why the code also expires and burns attempts.

## What breaks first at scale

1. **`notification_deliveries` grows unbounded.** One table for queue + audit means every message
   ever sent stays forever. At personal scale this is nothing; the first real fix is a retention
   job that deletes `sent`/`skipped` rows older than N days (the audit horizon), which is additive
   and needs no schema change. The claim index stays small because it's queried on `status`, and
   `pending` is always a tiny slice.
2. **The claim query has no `SKIP LOCKED`.** Phase 4's worker will need
   `... for update skip locked` (or a status-CAS on claim) so multiple concurrent workers don't
   grab the same row. Single-worker cron is fine until it isn't; the index is already the right
   shape for it.
3. **Spend counters are per-day rows, not a running ledger.** A rolling-30-day cap sums 30 rows
   per user per channel — fine at this cardinality, and the alternative (scanning
   `notification_deliveries`) is strictly worse. If it ever mattered, a materialized rolling total
   is a drop-in behind the same read.
4. **`getChannel` caches the registry per serverless instance.** Same tradeoff the agenda cache
   already documents (`docs/02-architecture.md`): a config change needs a cold start to take
   effect. Acceptable; noted so it isn't a surprise.

## Self-critique (continuous-improvement rule, applied to this design)

1. *Weakest point*: preference **defaults are hard-coded per kind** and email-only. The moment a
   user has only a verified phone, every default-email notification silently `skip`s until they
   change settings. Mitigation shipped: `enqueueNotification` returns `skipped[]` with the reason,
   so Phase 5 can surface "we couldn't reach you" instead of failing silent — the exact
   fake-success trap `docs/12-quality-audit.md` warns about, avoided by design.
2. *`is_primary` on first insert is a read-then-write*, not atomic — two contacts added in the same
   instant could both compute "I'm first". The partial unique index
   (`notification_contacts_primary_idx`) is the real guard: the second insert fails rather than
   creating a second primary. The count is an optimization, the index is the correctness boundary.
3. *No inbound path yet.* STOP/HELP for SMS (a legal requirement) and email unsubscribe are Phase 3
   and beyond. The substrate doesn't preclude them — an inbound webhook flips
   `notification_preferences.enabled` — but nothing enforces them today, so SMS must not ship
   before Phase 3 wires compliance.
4. *`payload jsonb` is unvalidated at the DB.* Each `kind` will want a typed payload; today the
   shape is a convention between the enqueuing pillar and the Phase 4 template that renders it. A
   Zod schema per kind (mirroring the tool catalog) is the natural hardening when templates land.
