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

---

# Phase 3: the SMS channel (Twilio)

SMS is the only channel that reliably interrupts someone — its value and its risk. Every decision
here answers "what happens when this loop runs over 500 users at 4am and each message costs money."
Three things are non-negotiable because they are A2P compliance law, not preferences: verified
opt-in, honored STOP/HELP/START, and a hard quiet-hours floor.

## Where each compliance rule is enforced

| Rule | Enforced in |
|---|---|
| Verified opt-in only (no manual override) | `planDeliveries` — an SMS contact is deliverable only if `verified_at` is set and `opted_out_at` is null (`enqueue.ts`) |
| STOP / UNSUBSCRIBE / CANCEL / END / QUIT → permanent opt-out | inbound webhook mirrors it to `opted_out_at`; Twilio error `21610` on send does the same |
| START / UNSTOP → re-subscribe | inbound webhook clears `opted_out_at` |
| HELP / INFO → service identity + opt-out info | Twilio Advanced Opt-Out auto-replies on the messaging service; we no-op (nothing to mirror) |
| Quiet-hours hard floor (22:00–08:00 local, non-urgent) | declared as `SMS_QUIET_FLOOR` (`limits.ts`); Phase 4 owns the scheduling math that applies it |

The webhook **mirrors** Twilio's own opt-out state rather than trusting Twilio to be the only
record. If we didn't, the DB would keep queueing to a number Twilio silently drops, and the
delivery log would lie about what the user received.

## The channel: form-encoded, Basic auth, no SDK

`channels/sms.ts` posts to Twilio's Messages endpoint with `fetch` — same no-SDK precedent as Google
and Resend. Two SDK-translation traps are commented in the code: the body is
`application/x-www-form-urlencoded` (not JSON), and auth is HTTP Basic (Account SID as user, Auth
Token as password). A Messaging Service SID is preferred over a bare From number because it handles
number pooling, sticky sender, and compliance routing.

Error mapping matters more than for email because failures cost money, and two codes mutate contact
state, not just delivery state — surfaced via `SendResult.contactAction`, which the worker applies:

- `21610` (recipient opted out) → non-retryable **and** `opt_out`: write `opted_out_at` so nothing
  queues here again.
- `21614` (invalid mobile number) → non-retryable **and** `invalidate`: clear `verified_at` so the
  number must be re-verified.
- `21408` (region not permitted) → non-retryable, distinct message, no contact mutation.
- `20429` / 5xx / network → retryable (rides the Phase 2 backoff).

## `normalizeAddress`: libphonenumber-js, and why the dependency earns its keep

A regex validates *shape*; `+15551234567` is well-formed and also a number Twilio bills us to
reject. We added **`libphonenumber-js`** (~145 kB, pure JS, no native deps, actively maintained) so
`normalizePhone` validates a number is *possible* for its region against Google's metadata and emits
canonical E.164. The alternative — a hand-rolled regex plus a default-region setting — cannot tell a
real number from a plausible-looking fake, and on the one channel where mistakes cost money that
distinction is the whole point. A bare national number is accepted only when
`NOTIFICATIONS_DEFAULT_REGION` is set; otherwise we refuse to guess a country, because a
wrong-country SMS is a real charge to a real stranger.

## Spend caps: enforced at enqueue, counted at send

Caps live in `limits.ts` as pure functions and are enforced in `enqueueNotification`, **before** a
row is created — queuing a message we'll refuse to send just produces a `failed` row and a confused
user. The brief put enforcement at enqueue; I kept that but fixed a hole in the obvious
implementation:

- The counter (`notification_spend`, incremented by the worker via the atomic
  `increment_notification_spend` RPC) increments **on `sent`**, so a retrying message isn't
  double-counted. Correct for billing, but a burst enqueued before anything sends would all read
  `count = 0` and all pass.
- So the enqueue-time check counts **sent-this-period + in-flight (pending/sending) SMS**
  (`readSmsUsage` → `evaluateCaps`). The in-flight term bounds a burst immediately; a retry stays
  one row, so it's still counted once at any instant. Periods are the user-**local** day and month
  (`localDay`/`monthRange`), so caps roll over at local midnight, tested across a DST transition.
- The worker keeps a **global per-run SMS cap** (`SMS_MAX_PER_RUN`) as a second line of defense: an
  over-cap run leaves SMS `pending` for the next tick rather than sending.

Over-cap SMS is, in order: dropped if email is already queued (the info still arrives), else
**downgraded to a verified email** if `downgrade_to_email` is on (the better outcome — the user
still gets the information), else written as a `skipped` audit row. The whole decision is the pure
`planWithCaps`, unit-tested without a database.

## Webhook signature: the one security detail that matters most

`sms/inbound/route.ts` validates `X-Twilio-Signature` (`twilio-signature.ts`: HMAC-SHA1 over URL +
sorted params, base64) against `TWILIO_AUTH_TOKEN` **before trusting a single byte of the body**. An
unauthenticated webhook that flips opt-out state is a trivial denial-of-service against your own
users — POST `STOP` for every number and nobody gets messaged again. Every mutation keys off the
phone **number** in the verified body, never a user id from the request. Status callbacks update the
delivery by `provider_message_id`; STOP/START mirror into `notification_contacts`. Conversational
inbound is a marked no-op extension point, not faked.

## A2P 10DLC lead time (deployment, not code)

US A2P traffic requires **A2P 10DLC brand + campaign registration before production sending** — it
takes days to approve, and unregistered traffic is carrier-filtered. Toll-free numbers are an
alternative but still need toll-free verification (also days). Documented in `.env.example` so it's
planned for, not discovered at launch.

---

# Phase 4: scheduling, dispatch, and assistant tools

Phases 1–3 built the substrate and channels; Phase 4 connects everything that already *knows*
something to the channel that can *say* it, and gives the assistant the vocabulary to schedule its
own follow-ups. Two halves: deterministic dispatch, and new Zod tools.

## Quiet hours (`schedule.ts`)

`resolveSendTime(desiredAt, prefs, timezone, opts)` is pure and DST-correct — it never adds
milliseconds to a UTC timestamp; every wall-clock conversion goes through `zonedTimeToUtc`
(`src/lib/utils`), so 08:00 local resolves right on the 23- and 25-hour days (both tested). A time
inside quiet hours is pushed to the window's end; midnight-crossing windows (22:00–08:00, the common
case) are handled explicitly. It iterates, because deferring to one window's end can land inside
another — an SMS floor ending at 08:00 that falls in a user's 07:00–09:00 window re-defers.

Urgent kinds bypass entirely; the set is defined once (`isUrgentKind`), not per call site. SMS also
carries a **hard floor** (22:00–08:00) that applies on top of the user's own window as a union — a
user may widen quiet hours but not remove the floor, because SMS is the one channel that wakes people.

## Reminder dispatch (`reminders.ts`) — one queue drainer, not two

The `reminders` table has existed since migration 002 and was never dispatched. `dispatchDueReminders`
runs inside the **existing** notifications cron (before `runWorker`), not a second cron — one drainer
is easier to reason about. It selects due, uncompleted, off-app reminders and calls
`enqueueNotification` with `dedupeKey: reminder:<id>`. Idempotency is layered: `dispatched_at` stops
re-scanning handled rows, and the delivery dedupe index backstops it if the mark is lost to a crash
(both tested). Quiet hours are applied inside enqueue via `resolveSendTime`, per channel.

### `reminders.notification_type` — one meaning, not two sources of truth

The column was `'in_app' | 'email' | 'push'` and dispatched nothing. Rather than leave it fighting the
Phase 1 preferences system, migration 010 makes it the reminder's **channel intent** with a single
precedence rule: `'auto'` (the new default for tool-created reminders) delegates entirely to
preferences; `'email'`/`'sms'` force a channel (an explicit "text me"); `'in_app'` surfaces in-app
only, no off-app send (legacy rows keep working). Preferences is the default, `notification_type` is
the per-reminder override — the schedule_reminder tool's `channel` argument has a home without a
redundant column. `'push'` is dropped (never implemented).

## Pillar hooks (`pillar-hooks.ts`)

Each pillar that computes something worth knowing hands it to the layer, guarded so a notification
failure never breaks the pillar. `ensureInsights` now returns *only the insights it actually
inserted* (the `ignoreDuplicates` upsert with `.select()` returns just the non-conflicting rows), so
re-running the rules never re-notifies — the insight id is a stable dedupe unit, and the delivery
dedupe key is the second guard. Fitness consistency-break insights route to the `fitness_nudge` kind
(so a user can mute training nudges without muting all insights); everything else is `insight`.
`generateWeeklyReview` success enqueues `finance_review`.

## Digest batching — the simple version, deliberately

When a kind's `digest` flag is on, its events for a (user, kind, local-day) coalesce into **one**
email instead of N. The coalescing is atomic: `append_digest_delivery` (migration 010) does the
insert-or-append in a single `jsonb ||` statement, so concurrent enqueues can't lose items — cleaner
than an application-side read-modify-write. A generic `renderDigest` lists the item summaries.

Scoped deliberately: **digest is email-only.** SMS volume is already bounded by spend caps, and
digest×caps accounting is a genuine complication for little gain, so SMS isn't digested. The other
documented limitation: the digest fires at the first item's resolved send time — there's no separate
"digest hour" scheduler; that's a later refinement, not over-engineered now.

## Assistant tools (`tools.ts`, `executor.ts`)

Four new Zod tools, each a single source of truth (runtime validation + the function-calling
contract): `schedule_reminder` (delivered, channel-aware — `channel` defaults to `'auto'` because
models over-pick SMS if allowed), `cancel_reminder` (find-by-words like `complete_task`, and it also
skips any queued-but-unsent delivery), `list_reminders`, and `notify_me` (a one-off "text me X",
rate-limited to 3 per 10 minutes per user as an abuse guard). Every handler reads its write `error`
and returns a failure — never the `complete_task` fake-success pattern — and mutations carry an
undoable receipt.

## A3 / A4 (quality audit)

Both were already fixed in the tree and are now covered by regression tests: A3 —
`complete_task` (and every new handler) surfaces a failed write as an `Error:` result with no
receipt; A4 — `runAssistant` collects tool failures into `AssistantResponse.failures`, rendered as
red chips by `ReceiptChips`, so "I texted you" can never mask a send that didn't happen. That honesty
is the precondition for trusting the whole pillar.

---

# Phase 5: surfaces

Everything above was reachable only through an API call or the database. Phase 5 gives it a face for
someone who isn't the author: `Settings → Notifications` (contacts, the preference matrix, quiet
hours / digest / caps, and a real **Test send**), a masked **delivery log** with fix links, and the
assistant awareness that keeps it honest.

## Logic vs pixels

UI is lightly tested here on purpose; the *logic* under it is not. Three pure modules are unit-tested
and carry the correctness weight:

- `mask.ts` — a masking bug that prints the full address into a screenshotted log is the failure
  mode, so `maskEmail`/`maskPhone` are tested to keep only the recognizable parts and degrade to
  `•••` on malformed input.
- `matrix.ts` — `deriveCellState` decides whether a (kind, channel) toggle is on, and whether it's
  *usable* (configured on the server AND a verified contact) or disabled-with-a-reason. The "disabled
  but explained" behavior is the whole UX bet: a control that teaches beats one that's missing.
- the test-send rate limit — a pure predicate (`testSendBlocked`) so the endpoint's guard is asserted
  rather than trusted.

## Test send records to the log

The test endpoint sends synchronously (instant "it works" feedback) *and* writes a
`notification_deliveries` row, so a test appears in the delivery log like any other send and the two
surfaces stay consistent. It's rate-limited by counting recent `test:`-keyed rows — no new table.

## The `last_error` contract, verified not assumed

The delivery log renders `last_error` directly. That is only safe because Phases 2–3 guaranteed
channel `error` fields are always user-safe sentences (raw provider bodies are logged server-side,
never returned). Phase 5 depends on that contract rather than re-sanitizing; the loader comments say
so, so the coupling is visible.

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

0. *Weakest point of the dispatch phase: everything is bound to the 5-minute cron.* A reminder for
   16:00 fires on the 16:00–16:05 tick, and `notify_me` "text me now" has the same latency — fine for
   a secretary, wrong for anything truly time-critical. The digest inherits this too: it goes out at
   the first item's resolved tick, not a chosen digest hour. The fix when it matters is a shorter
   cron (or a nearest-due wake-up), not a design change — the queue, lease, and dedupe already
   tolerate it. Called out so "the text was 4 minutes late" is understood, not a surprise.
0. *Phase 5 shipped the settings surface but deliberately deferred two first-run touches:* the
   onboarding "how should I reach you?" step and the one-time Today-dashboard nudge for a user with
   no verified contact. The definition of done — zero → verified email → successful test send *on the
   settings page* — holds without them, and folding two more surfaces into an already-large settings
   page was the rush the brief warned against. They're a clean, self-contained follow-up (one file
   each). Also deferred: the preference matrix saves the whole thing on one button rather than
   per-cell optimistic writes — simpler and matches the Profile form, at the cost of a less live feel.
0. *Weakest point of the SMS phase: cap counters race under concurrent sends.* Enqueue reads
   `sent-this-period + in-flight` and decides; two enqueues (or two worker instances) interleaving
   between read and the send-time increment can both pass a cap that only one should. The in-flight
   term shrinks the window versus a naive sent-only counter, and the per-run global cap and the DB
   dedupe index bound the blast radius, but nothing here is a true distributed semaphore. At this
   scale (one daily_plan per user per day, one 5-minute cron) the window is effectively never hit;
   the honest fix if it ever mattered is to move the check into the atomic `increment_notification_spend`
   RPC — increment-and-return, reject if over cap — so the read and the decision are one statement.
   Deliberately not built now: it trades the clean pure-function `evaluateCaps` (and its tests) for
   DB-resident logic, which isn't worth it until concurrency is real.
1. *Preference **defaults are hard-coded per kind** and email-only.* The moment a
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

---

# Phase 14: inbound replies (SMS shipped; email is the follow-up)

Every phase above talks *at* the user: the plan goes out, the reminder fires, and to act on it you
open a laptop. Phase 14 closes the loop — replying *"add milk to my list"* or *"move gym to 6"* by
text runs through the same assistant the ⌘K palette uses and answers with a receipt. This is the
phase that changes the product's category, and it is almost entirely **plumbing between components
that already exist** (`src/lib/notifications/inbound.ts`): the signature-validated webhook (Phase 3),
the Zod tool catalog, `runAssistant`, undoable receipts, memory recall, and the outbound channels to
reply on. The only genuinely new thing is a trust boundary, because this is the first surface where
something *outside* the app can cause a write.

**Scope of this session: SMS + the channel-agnostic pipeline.** Email inbound (Resend inbound-route
signature verification, MX/verified-domain setup, and quoted-history stripping across Gmail/Apple
Mail/Outlook) is a self-contained follow-up that calls the same `processInbound` — deliberately split
out because each of those three is its own risk area, and bundling them with the auth core is the
rush `CLAUDE.md` warns against.

## The trust model: a sender address is a claim, not a credential

Caller ID is trivially spoofed and an email `From` is trivially forged, so **the sender field in a
webhook body authenticates nothing.** Building "match the sender against a contact, then execute tool
calls as that user" without more would be an unauthenticated remote-execution path into someone's
calendar, tasks, and finances. Four controls, in the order they run
(`processInbound`, `src/lib/notifications/inbound.ts`):

1. **Signature first, before parsing a byte.** The Twilio HMAC (`twilio-signature.ts`, constant-time)
   is validated in the route; only a verified body reaches the pipeline. Resend inbound will get its
   own signature check to the same standard in the follow-up.
2. **Dedupe = the audit-row insert.** The first thing `processInbound` does is insert an
   `inbound_messages` row; the unique `(channel, provider_message_id)` index makes a webhook retry
   (they are at-least-once) collide and drop atomically — the same DB-enforced idempotency the
   delivery queue uses. *Every* inbound message gets a row, including every rejection, because a
   silent drop you can't investigate is the fake-success trap `docs/12` warns about.
3. **Resolve only via a verified contact, and refuse ambiguity.** The sender resolves to a user only
   through a `notification_contacts` row that is `verified_at` and not opted out. Unknown or
   unverified → dropped, audited, no reply. And critically: **an address that resolves to more than
   one user is refused, not guessed** — a shared household email or a recycled phone number maps to
   ≥2 verified contacts, and picking one would run writes as the wrong human. Ambiguous identity is
   treated exactly like an unknown sender.
4. **The reply goes to the stored verified address, never the webhook `From`.** Even past resolution,
   replying to the raw sender field would let a spoofer redirect the answer; we reply to the address
   on the resolved contact.

One more that isn't authentication but belongs to the same trust story: the assistant runs on a
**per-user scope over the service client** (`src/lib/supabase/scoped.ts`, the same Proxy the
daily-plan cron has used since Phase 4), so every read is filtered to the resolved user the way RLS
would for a session client. This is why `ai_conversations` had to join the scoped-table set —
`recordExchange` selects the most recent conversation *without* a user filter, which under an
unscoped service client would thread a text reply into a stranger's history.

## The tool-scope decision: one conservative allow-list, both channels

Inbound is a lower-trust channel than the web app, so its action surface is strictly smaller —
expressed **once**, as a typed `Set<ToolName>` in `src/lib/notifications/inbound-scope.ts`, derived
from the catalog (names can't drift) and enforced in **two** places: the tool list *offered* to the
model is narrowed (UX), and `executeToolCall` *refuses* an out-of-scope call with a legible error
(the security boundary — a model must never be trusted to self-limit).

- **Opt-in, not opt-out.** A new capability added to `tools.ts` is *not* reachable from a spoofable
  channel until someone adds it here on purpose. An opt-out list would silently widen the blast
  radius every time the assistant gained a tool.
- **The same set for both channels.** The tempting asymmetry — "email crosses SPF/DKIM, so trust it
  more" — doesn't hold: those authenticate the sending *server*, not the *human*, and say nothing
  about a compromised mailbox or a forwarded thread. The identity proof is the `verified_at` match in
  both cases, the same strength for each, so email earns no wider surface than SMS.
- **The line: reversible-or-read-only in, irreversible-or-third-party-fanning out.** Every mutating
  tool already returns an undoable receipt, so the only actions worth withholding are the ones a
  receipt can't take back. Excluded: **`delete_event`** (irreversible, and it emails a cancellation
  to other attendees — a spoofed "cancel my 3pm" is the exact abuse) and **`suggest_memory`** (needs
  an interactive Remember/Don't-remember surface a text thread doesn't have). Everything else,
  including `update_event` — "move gym to 6" is the feature's whole point — stays in. Once you
  subtract everything reversible, the entire "full catalog vs safe subset" debate collapses to a
  single question, *"should a reply be able to delete a calendar event?"*, and the answer is no. The
  confirmation-flow option ("reply yes within N minutes") was rejected because a yes/no round-trip is
  a held multi-turn session, which is explicitly out of scope.

## Loops and cost

An auto-reply that triggers an auto-reply is a billing incident and a spam complaint, so the guards
sit **in front of the AI call** (the expensive part):

- **Never answer a machine.** `isAutomatedSender` drops mail carrying `Auto-Submitted` (≠ `no`),
  `Precedence: bulk|list|junk`, or `List-Id`/`List-Unsubscribe`. (SMS never sets these; the guard is
  there for the email follow-up and is unit-tested now.)
- **Rate-limit per contact** — `MAX_PER_MINUTE = 4`, `MAX_PER_HOUR = 20`, counted from the
  `inbound_messages` audit rows and checked *before* `runAssistant`. Tests assert the assistant mock
  is never invoked on this path.
- **A reply counts against spend.** The outbound reply is logged as a `notification_deliveries` row
  and increments `notification_spend` for SMS — a reply is a message like any other.
- **One `runAssistant` call**, existing hop/time budgets, no fan-out.

The webhook returns `200` immediately and the assistant runs in `after()`, because the reason/act
loop is far slower than Twilio's webhook timeout — a synchronous run would time the webhook out and
trigger a retry. The immediate `200` avoids the retry; the dedupe index backstops it regardless.

## Threading and its honest failure mode

A reply usually means something only in the context of the message it answers ("move gym to 6" needs
this morning's plan). Email gives an `In-Reply-To`; **SMS gives nothing**, so both fall back to *"the
most recent `sent` delivery to this contact within `THREAD_WINDOW_HOURS` (12h)"* and the summarized
payload is prepended to the user's reply as context. This heuristic **will sometimes attach the wrong
context** — a reply to yesterday's plan sent after a fresh plan went out this morning will thread to
the new one. That is an accepted, documented wrong-sometimes, not a silent bug: the assistant still
runs, the receipt still tells the truth about what it did, and the audit row records exactly which
delivery it threaded to (`in_reply_to_delivery_id`). The email `In-Reply-To` path is scaffolded but
imperfect until the follow-up — Resend's `provider_message_id` isn't guaranteed to equal the `Message-ID`
the client references, so the recency fallback is the reliable one today.

## Self-critique

0. *The reply runs in `after()`, so a crash between the assistant's write and the reply send is a
   completed action with no confirmation.* The write is real (and undoable in-app), but the user
   never hears back — the one outcome the phase set out to avoid. The audit row lands as `failed`, so
   it's investigable, but there's no automatic retry of just the reply. A durable outbox for the
   reply (enqueue it like any other delivery instead of sending inline) would close this; it was
   deferred because inline send is what lets us fold tool `failures` into the reply text and answer
   in one turn.
1. *The threading heuristic is the weakest correctness point*, covered above — wrong-sometimes by
   construction. The mitigation is honesty (the receipt and the audit row), not accuracy.
2. *Verification proves opt-in at a point in time, not continuous ownership.* A recycled phone number
   or a handed-off mailbox stays a `verified_at` contact until someone notices; the ambiguity refusal
   only catches the case where *two* users hold it at once, not where one silently replaced another.
   This is inherent to phone/email as identity and can't be fully closed app-side; periodic
   re-verification is the real fix if it ever matters.
3. *Rate limits are per contact, not global per user.* A user with two verified numbers has twice the
   budget. At personal scale this is noise; a per-user aggregate is the drop-in if it isn't.
4. *A reply isn't gated on the SMS spend cap the way an outbound reminder is* — it counts toward the
   cap but isn't refused by it, on the reasoning that the per-contact rate limit is the real cost
   guard and refusing to answer a paying user mid-conversation is worse UX than the marginal spend.
   Stated here so the asymmetry with `enqueueNotification` is a decision, not an oversight.
