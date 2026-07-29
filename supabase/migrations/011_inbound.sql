-- Inbound replies (Phase 14): the audit log for every message that comes IN
-- from a user by SMS or email and is routed through the assistant. Additive
-- only — run once, after 010_reminders_dispatch.sql.
--
-- This is the first surface where something OUTSIDE the app can cause a write,
-- so the trust model matters more than the schema. A row is created for EVERY
-- inbound message — including ones we reject (unknown sender, unverified,
-- rate-limited, duplicate, automated). A silent drop you can't investigate is
-- the same fake-success trap docs/12-quality-audit.md warns about; here the
-- audit row is the investigation trail.

create table if not exists inbound_messages (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: a message from an unknown/unverified sender resolves to
  -- NO user, but still gets a row so the rejection is auditable. Set once the
  -- sender is resolved to a verified contact.
  user_id uuid references auth.users on delete cascade,
  contact_id uuid references notification_contacts on delete set null,
  channel text not null check (channel in ('email', 'sms')),
  -- The provider's message id (Twilio MessageSid, Resend inbound id). Webhooks
  -- are at-least-once, so this is the idempotency key: a duplicate delivery hits
  -- the unique index and is dropped before any AI call.
  provider_message_id text not null,
  body text not null default '',
  -- The delivery this reply threads to, when we can resolve one (email
  -- In-Reply-To, or the SMS "most recent delivery within N hours" heuristic).
  in_reply_to_delivery_id uuid references notification_deliveries on delete set null,
  -- received  → accepted, handed to the assistant
  -- processed → assistant ran and a reply was sent
  -- rejected  → dropped before the AI call (unknown/unverified/ambiguous sender,
  --             rate-limited, automated sender); `error` says which
  -- duplicate → provider_message_id already seen
  -- failed    → the assistant or the reply send errored after acceptance
  status text not null default 'received'
    check (status in ('received', 'processed', 'rejected', 'duplicate', 'failed')),
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Idempotency: one row per (channel, provider_message_id). The unique index —
-- not application code — makes a webhook retry a no-op, atomically under the
-- concurrency of two racing deliveries (same pattern as notification_deliveries).
create unique index if not exists inbound_messages_provider_idx
  on inbound_messages (channel, provider_message_id);

-- Rate-limit read: count a contact's recent inbound before spending an AI call.
create index if not exists inbound_messages_ratelimit_idx
  on inbound_messages (contact_id, created_at);

-- RLS: owner-only, matching every other table. Rejected rows with a null
-- user_id are invisible to all users by design — they are a server-side audit
-- trail, read via the service client, never surfaced to a signed-in user.
alter table inbound_messages enable row level security;
drop policy if exists "own inbound messages" on inbound_messages;
create policy "own inbound messages" on inbound_messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
