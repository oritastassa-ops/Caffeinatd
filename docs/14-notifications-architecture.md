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

---

# Phase 2: the email channel and the drain worker

Phase 1 could record intent; Phase 2 delivers it. The morning daily plan now lands in an inbox
before the app is opened. Two channels-worth of surface — `ResendChannel` and the cron worker —
plus templates and unsubscribe.

## The channel: Resend over `fetch`, no SDK

`src/lib/notifications/channels/email.ts` calls the Resend REST API directly, matching the repo's
Google-Calendar precedent (`src/lib/google/calendar.ts`, README "No Google SDK"): fewer deps, no
version churn, and — the part that actually earns it — full control over the response mapping,
which is where email reliability lives:

- **2xx** → `ok`, capture `providerMessageId`.
- **429 / 5xx** → `retryable`. Transient; the backoff will get it.
- **other 4xx** (bad address, suppressed recipient, auth) → **not** retryable. These never succeed
  on retry; retrying burns Resend quota and delays real mail behind a message that is already dead.
- **network / abort (timeout)** → retryable. A 10s `AbortController` bounds each send so one hung
  request can't consume the worker's whole budget.

The raw provider body is logged server-side under `[notifications:email]` (greppable in Vercel
logs) and **never** returned; `SendResult.error` is always a sentence a user could read — the same
rule as `TestConnectionResult` (`src/lib/integrations/types.ts`).

`NOTIFICATIONS_DRIVER` stays the single switch: `logging` (default) routes both channels to the
stub; `live` assembles real channels from vendor creds, and a channel whose creds are absent is
simply not registered — email works while SMS still degrades cleanly.

## Templates: typed functions, not a rendering framework

`src/lib/notifications/templates/` — each template is a pure `payload → { subject, text, html }`
function (no React Email, no MJML), unit-testable without a renderer. `text` is first-class, never
an afterthought: watches and text-only clients show it. The HTML obeys what email clients actually
enforce — a single centered table, every style inline, ~600px, a hidden preheader, no flex/grid, no
external CSS. A `<style>` block is used *only* for `prefers-color-scheme`, as progressive
enhancement that degrades to the inline light-mode values. Every payload string is escaped
(`escapeHtml`) so a reminder body of `<script>` can't inject.

Verification is deliberately standalone (`verification-code.ts`): transactional mail carries no
unsubscribe footer and no marketing chrome, and it must render `text` because SMS (Phase 3) sends
the same code through `body`.

### Why the unsubscribe link is signed

Every non-transactional email carries a one-click unsubscribe link and the matching
`List-Unsubscribe` / `List-Unsubscribe-Post: One-Click` headers (RFC 8058; Gmail bulk-sender rules
expect them). The token is an HMAC over `(userId, kind)` — a bare user id in the URL is an
enumeration hole (guess a uuid, unsubscribe a stranger). It's stateless (no DB row), and the route
uses the service client because the *signature is the authorization*; it writes only the
`(user, kind)` the token proves. Unsubscribe is granular — it removes `email` from that kind's
channels, not a blanket kill — reusing `resolvePreference` so the user keeps every other kind and
channel.

## The drain worker and its claim race

`src/app/api/cron/notifications/route.ts` (every 5 min, `CRON_SECRET` bearer, `maxDuration=60`,
batch 50) delegates to `runWorker` (`src/lib/notifications/worker.ts`), extracted so the
claim → send → finalize loop is testable against a fake Supabase and a fake channel. Unlike
enqueue, the worker is **cross-user by design** — it drains the whole queue — so it runs on the
service client.

**The race.** A plain `select pending` then `update sending` lets two overlapping cron invocations
both read the same row and send it twice. Two defenses:

1. **Conditional-update claim.** The claim is
   `update … set status='sending' where id = ? and status='pending'` returning the row. Under
   concurrency exactly one invocation's update matches `status='pending'`; the loser gets zero rows
   back and skips. This is atomic in Postgres without an explicit lock.
2. **Lease on `scheduled_for`, not a new column or `SKIP LOCKED`.** On claim, `scheduled_for` is
   pushed to `now + 10min`. A `sending` row is therefore invisible to the pending query
   (`scheduled_for <= now`) until its lease expires. Reclaiming a row stranded by a serverless
   timeout mid-send is then just `update … set status='pending' where status='sending' and
   scheduled_for <= now` — it falls out of the existing `(status, scheduled_for)` index with **no
   migration and no `FOR UPDATE SKIP LOCKED`**. For single-cron scale this is deliberately less
   machinery than a locking dequeue; the conditional update already closes the double-send, and the
   lease closes the stranded-row hole. If we ever run *concurrent* workers hot enough to contend,
   `SKIP LOCKED` is the next step — but that's provisioning we don't have.

**Backoff.** `src/lib/notifications/backoff.ts` is pure (asserted in tests): a retryable failure
reschedules at 1m, 5m, 25m, 2h, then capped at 2h; a non-retryable failure, or the 5th attempt,
lands `failed` with `last_error`. `resolveOutcome(result, priorAttempts)` is the whole decision,
so the worker's DB writes are a thin translation of it.

**Idempotency, end to end.** The daily-plan cron enqueues with
`dedupeKey = daily_plan:<user>:<date>`; the Phase 1 unique index means a re-run of the 04:00 cron
can't create a second row, and the worker only ever sends `pending` rows, so a second drain of an
already-`sent` row sends nothing. Both halves are covered by tests.

## Sending-domain prerequisite (SPF/DKIM)

`NOTIFICATIONS_FROM_EMAIL` must be on a domain **verified in Resend**, which means publishing the
SPF and DKIM DNS records Resend provides. Mail from an unverified domain is unauthenticated;
Gmail/Outlook route it to spam or reject it outright, and no amount of application code compensates.
This is deployment config, not code — called out here so "emails aren't arriving" has an obvious
first thing to check.

## What breaks first at scale

1. **`notification_deliveries` grows unbounded.** One table for queue + audit means every message
   ever sent stays forever. At personal scale this is nothing; the first real fix is a retention
   job that deletes `sent`/`skipped` rows older than N days (the audit horizon), which is additive
   and needs no schema change. The claim index stays small because it's queried on `status`, and
   `pending` is always a tiny slice.
2. **The claim query has no `SKIP LOCKED`.** The conditional-update claim + lease (above) makes the
   single 5-minute cron safe today. The day we run *concurrent* workers hot enough to contend on
   the same rows, `for update skip locked` becomes worth its complexity; the `(status,
   scheduled_for)` index is already the right shape for it.
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
3. *Inbound is still partial.* Email unsubscribe now ships (signed one-click link + header), but
   STOP/HELP for SMS — a legal requirement — is Phase 3. The substrate doesn't preclude it (an
   inbound webhook flips a preference the same way unsubscribe does), but nothing enforces it today,
   so SMS must not ship before Phase 3 wires compliance.
4. *`payload jsonb` is unvalidated at the DB, but validated at render.* Each template parses its
   payload with a Zod schema and throws on a mismatch, which the worker records as a non-retryable
   `failed` with the parse error in `last_error` — so a malformed payload surfaces loudly instead
   of sending garbage. The remaining gap is that the mismatch is caught at *send*, not at *enqueue*;
   validating in `enqueueNotification` per kind would move the failure earlier, to the pillar that
   caused it.
5. *A template throw fails the delivery, not the batch.* `renderEmail` is wrapped per row, so one
   bad payload can't strand the other 49 in a batch — but it also means a systematically broken
   template (shipped with a bug) fails every affected delivery silently until someone reads the
   `failed` rows. Phase 5's delivery-log surface is what makes that visible.
