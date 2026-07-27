-- Reminder dispatch + digest batching (Phase 4). Additive only — run once,
-- after 009_sms.sql.

-- ── reminders.notification_type: the reminder's channel INTENT ───────────────
-- Reconciled with the Phase 1 preferences system (docs/14): the column is now a
-- per-reminder override, with 'auto' delegating entirely to preferences. There
-- is one precedence rule (override > preference default), not two competing
-- sources of truth. Values:
--   in_app  → surface in the app only, no off-app delivery (legacy default kept)
--   auto    → dispatch via preferences (channels + verified contacts decide)
--   email   → force email; sms → force SMS
-- Old constraint allowed ('in_app','email','push'); 'push' is dropped (never
-- implemented) and 'sms'/'auto' added. Existing rows are 'in_app' and unaffected.
alter table reminders drop constraint if exists reminders_notification_type_check;
alter table reminders
  add constraint reminders_notification_type_check
  check (notification_type in ('in_app', 'auto', 'email', 'sms'));

-- Marks a reminder as already handed to the notification queue, so the 5-minute
-- dispatcher doesn't re-scan it every run. Idempotency is still guaranteed by the
-- delivery dedupe index (dedupe_key reminder:<id>); this is the cheap optimization.
alter table reminders add column if not exists dispatched_at timestamptz;
create index if not exists reminders_dispatch_idx
  on reminders (dispatched_at, remind_at) where completed_at is null;

-- Time-critical reminders bypass quiet hours (the dispatcher passes this to enqueue).
alter table reminders add column if not exists urgent boolean not null default false;

-- ── Atomic digest append ─────────────────────────────────────────────────────
-- When a kind has digest batching on, all of a user's events for that kind on a
-- local day coalesce into ONE delivery whose payload.items grows. Doing the
-- insert-or-append in a single statement avoids a read-modify-write race between
-- concurrent enqueues. Conflict target matches the partial unique index from 008
-- (user_id, dedupe_key, channel) where dedupe_key is not null.
create or replace function append_digest_delivery(
  p_user_id uuid,
  p_kind text,
  p_channel text,
  p_contact_id uuid,
  p_dedupe_key text,
  p_item jsonb,
  p_scheduled_for timestamptz
) returns void language sql as $$
  insert into notification_deliveries
    (user_id, kind, channel, contact_id, payload, dedupe_key, status, scheduled_for)
  values
    (p_user_id, p_kind, p_channel, p_contact_id,
     jsonb_build_object('digest', true, 'items', jsonb_build_array(p_item)),
     p_dedupe_key, 'pending', p_scheduled_for)
  on conflict (user_id, dedupe_key, channel) where dedupe_key is not null
  do update set
    payload = jsonb_set(
      notification_deliveries.payload,
      '{items}',
      coalesce(notification_deliveries.payload->'items', '[]'::jsonb) || p_item
    )
  -- Only keep coalescing while the digest hasn't gone out yet.
  where notification_deliveries.status = 'pending';
$$;
