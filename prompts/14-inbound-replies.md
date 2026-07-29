# Phase 14 — Inbound replies

Read `CLAUDE.md` first. Then `docs/14-notifications-architecture.md` and
`src/app/api/notifications/sms/inbound/route.ts`, which already marks this work as its extension
point at lines 10–11 and 106.

## Goal

Let the user reply to a notification and have that reply run through the assistant.

Today Caffeinatd only talks *at* you. The daily plan arrives at 6am and the conversation ends — to
act on it you open a laptop. After this phase, replying *"move gym to 6, and remind me to email
Dr. Chen"* by text or email does the thing and answers with a receipt.

This is the phase that changes the product's category. Everything needed already exists: the
inbound webhook with signature validation (Phase 3), the Zod tool catalog, `runAssistant`, undoable
receipts, memory recall, and the outbound channels to reply on. **This is plumbing between built
components, not new architecture.** Resist the urge to expand it.

## The three hard parts

Everything else is wiring. Get these right and the phase is done; get them wrong and it's a
liability.

### 1. Authentication — a sender address is not proof of identity

**A phone number in a webhook body is a claim, not a credential.** Caller ID spoofing is trivial,
and email `From` headers are trivially forged. If you resolve an inbound message to a user by
matching the sender against `notification_contacts` and then execute tool calls as that user, you
have built an unauthenticated remote-execution path into someone's calendar, tasks, and finances.

Requirements:

- Resolve sender → contact → user **only via a `verified_at` contact.** Unverified or unknown
  sender: drop silently, log server-side. Never auto-create.
- **Signature validation is mandatory and comes first**, before parsing anything. Twilio's is
  already implemented in `src/lib/notifications/twilio-signature.ts` — reuse it. Resend inbound
  needs its own webhook-signature check; implement it to the same standard, constant-time compare
  included.
- **Scope what inbound can do.** This is the important design decision, and I want your
  recommendation before you build. Options:
  - *Full tool catalog* — most useful, largest blast radius. A spoofed message deletes events.
  - *Read-only + a safe subset* (reminders, tasks, capture) — inbound can't touch finance or delete
    calendar events. Destructive tools stay web-only.
  - *Full catalog but destructive actions require confirmation* — reply "yes" within N minutes.

  **My lean is the safe subset for SMS and full catalog for email**, since email at least crosses a
  provider that does SPF/DKIM. Argue for what you think is right, but the default must be the
  conservative one. Whatever you choose, express it as an allow-list in one place, derived from the
  existing catalog in `src/lib/pipeline/tools.ts` — not a second copy of it that will drift.

### 2. Loops and cost

An auto-reply that triggers an auto-reply is a billing incident and a spam complaint. Concretely:

- **Never reply to a reply that came from an automated sender.** Check `Auto-Submitted`,
  `Precedence: bulk`, and `List-Id` headers on email; drop them.
- **Rate-limit inbound per contact** — a small number per minute and per hour, rejected before any
  AI call. The AI call is the expensive part; the guard goes in front of it.
- **Reuse the Phase 3 spend caps** for outbound replies. A reply is a message and counts against
  `notification_spend` like any other.
- **Bound the work per message.** One `runAssistant` call, existing loop guards, no fan-out.
- Deduplicate on the provider's message id — webhooks retry.

### 3. Threading and context

- Persist inbound and the reply through `recordExchange` in `src/lib/conversations.ts`, so a text
  conversation and a ⌘K conversation are the same history.
- A reply usually refers to the message it answers ("move gym to 6" only means something given this
  morning's plan). Pass the originating `notification_deliveries` row's payload as context when the
  reply is threaded to one. Email gives you `In-Reply-To`; SMS gives you nothing, so fall back to
  "the most recent delivery to this contact within N hours" and document the heuristic honestly —
  it will sometimes be wrong.

## Deliverables

1. **Migration `011_inbound.sql`** (check the next free number) — `inbound_messages`: `user_id`,
   `contact_id`, `channel`, `provider_message_id` (unique), `body`, `in_reply_to_delivery_id`,
   `status`, `processed_at`, `error`. This is the audit log for everything that came in, including
   what was rejected and why. Rejected messages get rows too — a silent drop you can't investigate
   is the same fake-success trap `docs/12-quality-audit.md` warns about.

2. **`src/lib/notifications/inbound.ts`** — the channel-agnostic pipeline: verify → resolve →
   rate-limit → dedupe → thread → `runAssistant` with the scoped tool set → send reply → record.
   Both channels call this; neither reimplements it.

3. **SMS inbound** — extend the existing route at the marked extension point. Keep STOP/HELP
   handling ahead of assistant routing; compliance keywords are never a prompt.

4. **Email inbound** — `POST /api/notifications/email/inbound`. Resend inbound routing needs a
   verified domain and an MX record; document the setup in `README.md`. Strip quoted history and
   signatures before the body reaches the model — an unstripped reply feeds the entire thread back
   in and wrecks both cost and comprehension.

5. **Reply formatting** — replies go out through the existing channel abstraction and templates.
   SMS replies are short and unformatted; segment-aware, truncated with a "see the app" pointer
   rather than fragmenting into five texts. Failures reply with the failure — silence after "move
   my 3pm" is the worst possible outcome.

6. **Docs** — extend `docs/14-notifications-architecture.md` with an inbound section: the trust
   model and why a sender address isn't authentication, the tool-scope decision and its reasoning,
   the threading heuristic and its failure mode, and a self-critique.

## Tests

- Signature validation rejects tampered bodies on both channels.
- Unverified and unknown senders are dropped, and leave an audit row.
- Rate limit rejects before any provider call — assert the AI mock was never invoked.
- Duplicate `provider_message_id` is a no-op.
- Auto-reply headers are detected and dropped.
- Quoted-history stripping across the common client formats (Gmail, Apple Mail, Outlook).
- Tool scoping: an out-of-scope tool requested via inbound is refused, and the refusal is legible.

## Out of scope

Voice. MMS and attachments. Multi-turn clarification (one message, one action — if the assistant
needs to ask, it asks and the user replies again; that's a new inbound message, not a held session).
Group messaging.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- Replying to the daily-plan email creates a task and gets a receipt back.
- Replying by SMS does the same within the scoped tool set.
- A spoofed sender does nothing and leaves an audit row.
- Two identical webhook deliveries produce one action.
- `docs/14-notifications-architecture.md` has its inbound section and self-critique.
- One commit, imperative message.

**Before writing code:** give me your recommendation on tool scoping, and tell me whether you'd
build both channels in one session or ship SMS first. Also flag anything in the trust model you
think is under-specified — this is the first surface where something outside the app can cause a
write, and I'd rather over-think it now.
