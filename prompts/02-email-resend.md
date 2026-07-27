# Phase 2 — Email channel (Resend)

Continues the notification pillar. Phase 1 (`prompts/01-foundation.md`) must be merged first —
read `docs/14-notifications-architecture.md` and `src/lib/notifications/` before starting.

## Goal

Real email delivery, plus the worker that drains the queue. After this phase the morning daily
plan lands in an inbox before you open the app.

## Deliverables

### 1. `src/lib/notifications/channels/email.ts`

`ResendChannel implements NotificationChannel`. Constructed from `RESEND_API_KEY` and
`NOTIFICATIONS_FROM_EMAIL`; registered in `channelRegistry` only when both are present.

Call the Resend REST API directly with `fetch`. **Do not add the SDK.** The repo has a stated
precedent — `src/lib/google/` calls Calendar REST with no Google SDK, and `README.md` lists it
as a design decision. Follow it: fewer dependencies, no version churn, full control of error
mapping.

Map responses carefully:

- 2xx → `{ ok: true, providerMessageId }`.
- 429 and 5xx → `{ ok: false, retryable: true }`.
- 4xx other than 429 → `{ ok: false, retryable: false }` — a malformed address or a suppressed
  recipient will never succeed on retry, and retrying it burns quota and delays real mail.
- Network/timeout → retryable.

`error` is always a sentence a user could read. Log the raw body server-side with
`console.error` and a stable prefix (`[notifications:email]`) so it is greppable in Vercel logs.

`normalizeAddress`: trim, lowercase the domain, validate shape. Reject obvious disposables only
if you can do it without a bundled list — otherwise skip and note it in the doc.

### 2. Templates — `src/lib/notifications/templates/`

Plain functions, `payload → { subject, text, html }`. No React Email, no MJML — a template here
is a typed function returning strings, unit-testable without a renderer.

Ship templates for: `daily_plan`, `reminder`, `verification_code`, `finance_review`. Each
returns both `text` and `html`; `text` is never a fallback afterthought, since some clients and
most watches show it.

HTML constraints that actually matter in email clients: table-based layout, inline styles only,
no flexbox or grid, no external CSS, max width ~600px, a plain-text preheader. Keep it
restrained — a clean typographic email, not a marketing blast. Dark-mode-safe colors
(`prefers-color-scheme` in a `<style>` block is fine as progressive enhancement).

Every email includes a one-click unsubscribe/preferences link with a signed token (HMAC over
user id + kind, keyed by `ENCRYPTION_KEY` or a dedicated secret). Bare user ids in a URL are an
enumeration hole; for a real product this is table stakes, and Gmail bulk-sender rules expect
`List-Unsubscribe`. Set that header.

### 3. Delivery worker — `src/app/api/cron/notifications/route.ts`

Authenticated by `CRON_SECRET` bearer, exactly as `src/app/api/cron/daily-plan/route.ts` does.
Registered in `vercel.json` — start at every 5 minutes (`*/5 * * * *`); Phase 4 may tighten it.

The claim loop, in order:

1. Select `pending` deliveries where `scheduled_for <= now()`, ordered oldest first, limited to
   a batch size (start at 50 — bound the serverless budget).
2. Atomically transition `pending → sending` before calling the provider. A plain
   `select` then `update` races with a re-invoked cron. Use a conditional update
   (`.eq('status','pending')`) and only process rows the update actually claimed, or a
   Postgres function with `for update skip locked`. Say which you chose and why in the doc.
3. Send. On success → `sent`, record `provider_message_id`, `sent_at`. On retryable failure →
   back to `pending` with `attempts + 1` and `scheduled_for` pushed out by exponential backoff
   (1m, 5m, 25m, 2h, capped). On non-retryable, or after 5 attempts → `failed` with
   `last_error`.
4. Rows stuck in `sending` for more than 10 minutes are reclaimed as `pending` — a serverless
   timeout mid-send must not strand a message forever.

Set an explicit `export const maxDuration` on the route, as `src/app/api/assistant/route.ts:13`
does (it uses 300). The worker needs far less — 60 is ample for a batch of 50 — but set it
deliberately rather than inheriting the platform default, and keep the batch size and the
duration consistent with each other.

Return a JSON summary (`{ claimed, sent, failed, retried }`). Never return user content.

### 4. Wire the daily plan

In `src/app/api/cron/daily-plan/route.ts`, after `generateDailyPlan` succeeds for a user, call
`enqueueNotification` with kind `daily_plan` and `dedupeKey` of the form
`daily_plan:${profile.id}:${planDate}`. That key is why a re-run of the 04:00 cron cannot
double-send.

Only enqueue on real success. `docs/12-quality-audit.md` §A1 and §A2 document that
`generateDailyPlan` currently returns a plan even when the upsert fails and degrades silently to
an empty plan on unparseable JSON. **Fix both while you are here** — read the upsert `error` and
throw; make `parsePlanJSON` failure explicit rather than returning an empty-priorities plan.
Emailing a user an empty plan every morning is worse than emailing nothing.

Guard the enqueue with `.catch()` so a notification failure never fails plan generation.

### 5. Docs + env

`.env.example`: `RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL`, with a comment on domain
verification in Resend and why an unverified sending domain lands in spam.

Extend `docs/14-notifications-architecture.md`: the claim strategy and its race analysis, the
backoff schedule, why non-retryable 4xx is not retried, and the sending-domain/SPF/DKIM
prerequisite.

## Tests

- Backoff schedule is a pure function; assert the sequence and the cap.
- Provider response mapping: 200, 401, 422, 429, 500, network error each map to the right
  `SendResult`. Mock `fetch`.
- Templates: snapshot `text` output; assert the HTML contains no `<style>`-dependent layout and
  that the unsubscribe token round-trips and rejects tampering.
- Worker: with a fake channel, a failing-then-succeeding send lands `sent` after the right number
  of attempts; a non-retryable failure lands `failed` immediately.

## Out of scope

SMS. Push. UI. Inbound email. Digest batching.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- With real Resend credentials, a manually enqueued `daily_plan` delivery is sent and the row
  reaches `sent` with a `provider_message_id`.
- Running the worker twice in a row sends nothing the second time.
- The two quality-audit bugs (A1, A2) are fixed, with a test proving a failed upsert now
  surfaces.
- One commit, imperative message matching `git log` style.

Start by stating your plan and flagging anything here you would design differently — especially
the claim strategy, where I may be over- or under-engineering for the current scale.
