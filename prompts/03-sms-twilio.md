# Phase 3 — SMS channel (Twilio)

Continues the notification pillar. Requires Phase 1. Independent of Phase 2, but reuses the
worker if Phase 2 shipped — do not build a second worker.

## Goal

SMS delivery that is safe to point at real users: verified numbers only, enforced spend caps,
and legally required opt-out handling.

SMS is the only channel that reliably interrupts someone. That is its value and its risk. Treat
every design decision here as "what happens when this loop runs over 500 users at 4am and each
message costs money."

## Non-negotiables before any message sends

These are compliance requirements for A2P messaging in the US and Canada, not preferences. Get
them wrong and the number gets suspended.

1. **Verified opt-in.** A number is only messageable after the OTP flow from Phase 1 completes.
   Record `verified_at`; there is no manual override path.
2. **STOP / UNSUBSCRIBE / CANCEL / END / QUIT** must immediately and permanently opt the number
   out. **HELP / INFO** must return a message identifying the service and how to opt out.
   **START / UNSTOP** re-subscribes. Twilio handles these automatically on most numbers, but the
   app must mirror the state — otherwise the DB keeps queueing to a number Twilio silently drops,
   and the delivery log lies.
3. **Identify the sender** in the first message a user receives, and include opt-out language.
4. **Quiet hours are honored for SMS even when the user disabled them elsewhere** — default a
   hard floor (no SMS 22:00–08:00 local) that the user may narrow but not remove for
   non-urgent kinds. Phase 4 owns the scheduling math; this phase declares the constraint.

## Deliverables

### 1. `src/lib/notifications/channels/sms.ts`

`TwilioChannel implements NotificationChannel`. Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID` — support both, prefer the messaging
service since it handles number pooling and compliance routing). Registered only when
credentials are present.

REST via `fetch`, no SDK — same precedent as `src/lib/google/` and Phase 2's Resend client.
Twilio's Messages endpoint takes `application/x-www-form-urlencoded` and HTTP Basic auth; note
that in a comment because it is the one thing people get wrong translating from the SDK.

Pass `Idempotency-Key` from `SendRequest.idempotencyKey` where Twilio supports it; where it does
not, the DB unique index from Phase 1 remains the guarantee.

Error mapping matters more here than for email because failures cost money:

- `21610` (recipient opted out) → non-retryable, **and** write the opt-out back to
  `notification_contacts` so nothing queues to that number again.
- `21614` (invalid mobile number) → non-retryable, mark the contact unverified.
- `20429` / 5xx / network → retryable.
- `21408` (permission for region not enabled) → non-retryable, distinct user-facing message.

### 2. `normalizeAddress` — E.164

Normalize to strict E.164 before storage. Do this with a real parser, not a regex — a regex that
accepts `+15551234567` will also happily accept nonsense that Twilio bills you to reject.

Prefer `libphonenumber-js` (small, well-maintained, no native deps) over hand-rolling. That is a
new dependency; justify it in the doc, or if you decide against it, implement strict validation
plus a default-region setting and explain the tradeoff. Either answer is defensible — pick one
deliberately and say why.

### 3. Spend caps — `src/lib/notifications/limits.ts`

Enforced in `enqueueNotification`, before a row is created, not in the worker. Queuing a message
you will refuse to send just produces a `failed` row and a confused user.

- Per-user daily and monthly SMS caps, defaults in env (`SMS_DAILY_CAP`, `SMS_MONTHLY_CAP`),
  overridable per user in `notification_preferences`.
- A global per-run cap in the worker as a second line of defense against a runaway loop.
- Over cap → the delivery is created with status `skipped` and a reason, or downgraded to email
  if the user has a verified email and the kind allows it. **Downgrade is the better behavior**
  — the user still gets the information. Implement downgrade; make it a preference.
- Increment the counter on `sent`, not on enqueue, so retries of a failed send don't double-count.

Write the cap logic as pure functions over `(sentCount, cap, now)` and unit-test the rollover
boundaries in the user's timezone, not UTC.

### 4. Inbound webhook — `src/app/api/notifications/sms/inbound/route.ts`

Handles Twilio's status callbacks and inbound messages.

- **Validate the `X-Twilio-Signature` header** against `TWILIO_AUTH_TOKEN` before trusting a
  single byte of the body. An unauthenticated webhook that mutates opt-out state is a trivial
  denial-of-service against your own users. This is the single most important security detail in
  this phase.
- Status callbacks (`delivered`, `undelivered`, `failed`) update the matching
  `notification_deliveries` row by `provider_message_id`.
- Inbound `STOP`/`START`/`HELP` mirror into `notification_contacts`.
- Uses the service-role client (there is no session), scoped by looking the contact up by
  number — never trust a user id from the request body.

Non-compliance inbound messages ("reply to your assistant by text") are **out of scope**; leave
a clearly marked extension point and do not fake it.

### 5. Docs + env

`.env.example` entries with comments covering: A2P 10DLC registration is required before
production US traffic and takes days to approve — say so, because it will otherwise be
discovered at launch. Note the toll-free verification alternative.

Extend `docs/14-notifications-architecture.md`: compliance requirements and where each is
enforced, the cap-and-downgrade policy, the webhook signature check, and a self-critique naming
the weakest point (likely: cap counters under concurrent sends).

## Tests

- E.164 normalization: valid, invalid, ambiguous-without-region cases.
- Error-code mapping table, including the two codes that mutate contact state.
- Cap math: boundary at exactly the cap, rollover at local midnight across a DST transition,
  downgrade-to-email path.
- Webhook signature validation accepts a correctly signed request and rejects a tampered body.

## Out of scope

Email (Phase 2). Conversational inbound SMS. MMS. WhatsApp.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- A verified test number receives a message; an unverified one is refused at enqueue.
- Texting STOP to the number flips the contact to opted-out and subsequent enqueues skip it.
- A forged webhook request is rejected with 403.
- One commit, imperative message.

State your plan first. I especially want your read on the `libphonenumber-js` question and on
whether cap enforcement belongs at enqueue or send time — argue for the better design if you
think I've got it backwards.
