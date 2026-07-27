# Phase 1 — Notification foundation

You are working in Caffeinatd, a Next.js 15 (App Router, React 19, TypeScript strict) personal
AI assistant backed by Supabase (Postgres + pgvector + RLS). Read `README.md`,
`docs/02-architecture.md`, and `docs/12-quality-audit.md` before writing code.

## Goal

Build the channel-agnostic notification substrate. **No message is actually sent in this phase.**
By the end, the system can record what should be delivered, to whom, on which channel, and
whether the destination is verified — with a `LoggingChannel` stub proving the path end to end.

Getting this layer right is the whole point of doing it separately. Phases 2 and 3 should be
able to add Resend and Twilio by writing one file each plus a registry entry, touching nothing
else.

## Context you need

- `src/lib/ai/types.ts` + `src/lib/ai/index.ts` — the `AIProvider` interface and factory. This
  is the abstraction pattern to mirror: one interface, one factory, callers never branch on
  provider name.
- `src/lib/integrations/registry.ts` — `integrationRegistry`, the second instance of that
  pattern. Note the comment explaining that adding a provider means one entry plus one folder.
- `src/lib/integrations/crypto.ts` — `encryptSecret` / `decryptSecret`, AES-256-GCM, keyed by
  `ENCRYPTION_KEY`. Reuse this; do not write new crypto.
- `supabase/migrations/002_phase1.sql:67-81` — the existing `reminders` table. It already has
  `notification_type text check (... in ('in_app','email','push'))` and RLS. Nothing dispatches
  it. Phase 4 will; design around it now.
- `src/app/api/cron/daily-plan/route.ts` — how cron authenticates (`CRON_SECRET` bearer) and how
  `scopedClient()` forces per-user scoping under the service-role key.
- `.env.example` — the documented-env convention. Every new var gets a commented entry.

## Deliverables

### 1. Migration `supabase/migrations/008_notifications.sql`

Additive only. Tables, with RLS policies matching the existing `user_id = auth.uid()` pattern:

- **`notification_contacts`** — a user's destinations. One row per (user, channel, address).
  Columns: `id`, `user_id`, `channel` (`'email' | 'sms'`, extensible), `address` (email or E.164),
  `label`, `verified_at`, `verification_code_hash`, `verification_expires_at`,
  `verification_attempts`, `is_primary`, `created_at`. Unique on `(user_id, channel, address)`.
  Store only a hash of the verification code, never the code.
- **`notification_preferences`** — per user, per notification *kind*, which channels are on.
  Kinds are an enum-ish text column: `daily_plan`, `reminder`, `insight`, `finance_review`,
  `fitness_nudge`, `system`. Columns include `enabled`, `channels text[]`, plus timezone-aware
  `quiet_hours_start` / `quiet_hours_end` (time, nullable) and `digest` (boolean, default false).
  Seed sensible defaults on first read rather than requiring a UI round-trip — follow the
  seed-on-first-visit approach in `src/lib/workspaces/data.ts`.
- **`notification_deliveries`** — the queue and the audit log, one table. Columns: `id`,
  `user_id`, `kind`, `channel`, `contact_id`, `payload jsonb`, `dedupe_key text`,
  `status` (`'pending' | 'sending' | 'sent' | 'failed' | 'skipped'`), `attempts`,
  `scheduled_for timestamptz`, `sent_at`, `provider_message_id`, `last_error`, `created_at`.
  **Unique index on `(user_id, dedupe_key)` where `dedupe_key is not null`** — this is the
  idempotency guarantee that stops cron retries from double-sending.
  Index on `(status, scheduled_for)` for the worker's claim query.

Add a `notification_spend` table (or columns on preferences) tracking per-user message counts
per rolling period. Phase 3 enforces caps against it; define it now so SMS doesn't bolt it on.

### 2. Channel abstraction — `src/lib/notifications/types.ts`

```ts
export type NotificationChannelName = "email" | "sms";

export interface SendRequest {
  to: string;              // verified address
  subject?: string;        // email only; SMS ignores
  body: string;            // plain text, always present
  html?: string;           // email only
  idempotencyKey: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  /** Safe, user-facing. Never the provider's raw error body. */
  error?: string;
  retryable: boolean;
}

export interface NotificationChannel {
  readonly name: NotificationChannelName;
  send(req: SendRequest): Promise<SendResult>;
  /** Validate + normalize a destination before it is ever stored. */
  normalizeAddress(raw: string): { ok: true; address: string } | { ok: false; error: string };
}
```

Mirror `TestConnectionResult` in `src/lib/integrations/types.ts`: the `error` field is always a
message safe to show a user. Raw provider bodies get logged server-side, never returned.

### 3. Registry + factory — `src/lib/notifications/registry.ts`

`channelRegistry: Partial<Record<NotificationChannelName, NotificationChannel>>`, populated from
env the way `createProvider()` does. A channel with no configured credentials is simply absent
from the registry — callers check presence rather than catching construction errors. Export
`getChannel(name)` returning `NotificationChannel | null` and `availableChannels()`.

Ship a `LoggingChannel` in `src/lib/notifications/channels/logging.ts` that satisfies the
interface, writes to `console.info`, and returns a synthetic message id. Register it when
`NOTIFICATIONS_DRIVER=logging`. This makes Phase 4 testable before any vendor exists and gives
local dev a zero-cost path.

### 4. Enqueue API — `src/lib/notifications/enqueue.ts`

One function every pillar will call:

```ts
enqueueNotification(supabase, {
  userId, kind, payload, dedupeKey?, scheduledFor?
}): Promise<{ queued: number; skipped: string[] }>
```

It resolves preferences → verified contacts → one `notification_deliveries` row per channel.
Behavior that must be right:

- Unverified contact → no row, `skipped` records why. Never queue to an unverified address.
- Preference disabled for that kind/channel → skipped.
- Duplicate `dedupeKey` → the unique index rejects it; catch that specific conflict and treat it
  as success (already queued), not an error. Distinguish this from real failures.
- **Every Supabase call reads `error` and propagates.** See `docs/12-quality-audit.md` §A for
  why this rule exists.

### 5. Verification flow (email + SMS share it)

`src/lib/notifications/verification.ts`: generate a 6-digit code, store only a hash
(`crypto.createHash('sha256')`, or bcrypt-style if you prefer — justify the choice), 10-minute
expiry, max 5 attempts, then the code is dead and must be re-requested. Rate-limit code
*requests* per contact. Sending the code goes through the channel abstraction, so this works
unchanged once Phases 2 and 3 land.

Routes: `POST /api/notifications/contacts` (add + send code),
`POST /api/notifications/contacts/verify`, `DELETE /api/notifications/contacts/[id]`.
All session-scoped — no service-role client.

### 6. Env + docs

Add to `.env.example` with explanatory comments: `NOTIFICATIONS_DRIVER` (`logging` default),
plus placeholders for the Phase 2/3 vars so the file reads as one coherent story.

Write `docs/14-notifications-architecture.md` in the voice of the existing docs — they explain
*why*, cite `file:line`, and include a self-critique section (see the end of
`docs/04-roadmap.md`). Cover: why the queue and audit log are one table, why dedupe lives in a
unique index rather than application code, and what breaks first at scale.

## Tests (`tests/notifications-*.test.ts`)

- `normalizeAddress` accepts and rejects the right emails and phone shapes.
- `enqueueNotification` skips unverified contacts, skips disabled preferences, and treats a
  duplicate `dedupeKey` as idempotent success.
- Verification: code expiry, attempt exhaustion, hash never equals the plaintext code.
- Registry returns `null` for an unconfigured channel rather than throwing.

Use the fixture style already in `tests/finance-fixtures.ts` and `tests/home-fixtures.ts`.

## Out of scope

No Resend. No Twilio. No cron. No UI. No changes to `src/lib/pipeline/tools.ts`. If you find
yourself editing the assistant pipeline, stop — that is Phase 4.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` all pass.
- With `NOTIFICATIONS_DRIVER=logging`, calling `enqueueNotification` for a verified contact
  produces a `pending` row and the `LoggingChannel` can send it.
- `docs/14-notifications-architecture.md` exists and includes the self-critique section.
- A single git commit with a message in the style of `git log` (imperative, one line, explains
  the change not the files).

Before you start: state your implementation plan and flag anything in this brief you think is
wrong or would design differently. Push back if you disagree — I want the better architecture,
not agreement.
