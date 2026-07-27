# Notification pillar — phased Claude Code prompts

Five prompts, run in order, one per session. Each is self-contained: paste the file contents
into Claude Code (Opus 5, High reasoning) with this repo open.

## Why this order

Caffeinatd can already decide what you should know. It has no way to tell you. Every pillar
(daily plan, reminders, insights, finance reviews, missed workouts) currently dead-ends at a
page you have to open. `reminders.notification_type` has accepted `'in_app' | 'email' | 'push'`
since migration `002_phase1.sql` and nothing has ever dispatched one. That gap — not more
domains — is what separates this from a secretary.

The phases build a channel-agnostic delivery system first, then two concrete channels, then
wire the existing pillars into it, then expose it.

| Phase | Prompt | Ships |
|---|---|---|
| 1 | `01-foundation.md` | Schema, `NotificationChannel` abstraction, preferences, contact verification |
| 2 | `02-email-resend.md` | Resend provider, templates, delivery worker, retry/backoff |
| 3 | `03-sms-twilio.md` | Twilio provider, phone OTP, STOP/HELP compliance, spend caps |
| 4 | `04-dispatch-and-tools.md` | Minute cron, quiet hours, reminder dispatch, new Zod assistant tools |
| 5 | `05-surfaces.md` | Settings UI, delivery log, failure surfacing in the assistant |

Phases 2 and 3 are independent of each other — either can be skipped or reordered. Phase 4
depends on 1 and at least one of 2/3.

## Standing constraints (repeat in every session)

These are already true of the codebase; new code must not regress them.

- **TypeScript strict.** `npm run typecheck` must pass. No `any`, no non-null assertions to
  silence the compiler.
- **Never swallow a write error.** `docs/12-quality-audit.md` documents four places where an
  unchecked Supabase error produced a fake success chip. Every `.insert()`, `.update()`,
  `.upsert()`, `.delete()` reads `error` and propagates it. This is the highest-value rule in
  the repo.
- **RLS everywhere.** Session-scoped clients act as the user. The service-role client is only
  for cron routes, and must be user-scoped explicitly — see `scopedClient()` in
  `src/app/api/cron/daily-plan/route.ts`.
- **Secrets encrypted at rest.** Reuse `encryptSecret`/`decryptSecret` from
  `src/lib/integrations/crypto.ts` (AES-256-GCM). Never store a provider token in plaintext,
  never send one to the client.
- **Provider abstraction over branching.** Follow the two existing patterns: the `AIProvider`
  interface + factory in `src/lib/ai/`, and `integrationRegistry` in
  `src/lib/integrations/registry.ts`. Callers depend on the interface, never on a provider name.
- **Vitest coverage for logic.** Pure functions (scheduling windows, quiet-hour math, retry
  backoff, template rendering, phone normalization) get unit tests in `tests/`. Network calls
  are behind an interface and mocked.
- **Migrations are additive and numbered.** Next free number is `008`. Never edit a shipped
  migration.
- **Design bar.** Any UI matches the existing surfaces — Tailwind 4, clean, minimal, generous
  whitespace, subtle motion. Reference points: Linear, Raycast, Vercel, Stripe. Nothing that
  reads as a default component library.

## Multi-tenancy note

The target is a real product with other users, not a household of two. That changes three
things from the current README's stated assumptions, and each phase calls out its share:

1. Sending to an unverified email or phone is an abuse vector and, for SMS, a legal problem.
   Verification is built in Phase 1 and 3, not deferred.
2. Per-user spend must be capped. An unbounded Twilio loop over a growing user table is a
   billing incident.
3. Delivery must be idempotent. Cron retries, Vercel re-invocations, and user-triggered sends
   must not double-send.

## Health pillar (Phases 6–8)

A second track, independent of the notification work above. Same conventions; `CLAUDE.md` in the
repo root now carries the standing constraints, so these prompts don't repeat them.

| Phase | Prompt | Ships |
|---|---|---|
| 6 | `06-body-metrics.md` | Time-series metric layer, weight / sleep actuals / resting HR, readiness integration |
| 7 | `07-nutrition.md` | Food database provider, `meal_items` with real portions, looked-up vs. estimated macros |
| 8 | `08-apple-health.md` | Streaming Apple Health export import into the Phase 6 layer |

Phase 6 must run first — 7 and 8 both build on it. 7 and 8 are independent of each other.

Each opens with a design question I deliberately left open (generic vs. per-metric tables; which
food API; client-side vs. server-side parsing). Expect Claude Code to argue a position before
implementing, and read that argument.

## After Phase 5

Natural follow-ons, in rough priority order: web push (free, no vendor, already on the
roadmap in `docs/04-roadmap.md`); inbound email/SMS replies routed into the assistant
pipeline; digest batching so a busy day doesn't become twenty texts; per-user provider keys
so heavy users bring their own Resend/Twilio accounts.
