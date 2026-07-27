-- SMS channel (Phase 3): opt-out state, per-user spend caps, and an atomic
-- spend counter. Additive only — run once, after 008_notifications.sql.
-- SMS costs money and is legally regulated, so this migration adds the state the
-- app needs to (a) never message a number that texted STOP and (b) never exceed
-- a per-user cap.

-- ── Opt-out state on contacts ────────────────────────────────────────────────
-- Set when Twilio reports code 21610 (recipient opted out) or an inbound STOP is
-- received; cleared by an inbound START/UNSTOP. enqueue treats an opted-out
-- contact as undeliverable, so the DB never queues to a number Twilio will drop.
alter table notification_contacts
  add column if not exists opted_out_at timestamptz;

-- ── Per-user SMS cap overrides + downgrade preference ────────────────────────
-- Null cap columns mean "use the env default" (SMS_DAILY_CAP / SMS_MONTHLY_CAP);
-- a value overrides it for that (user, kind). downgrade_to_email: when an SMS is
-- over cap, send it as email instead of dropping it (the better default — the
-- user still gets the information).
alter table notification_preferences
  add column if not exists sms_daily_cap integer,
  add column if not exists sms_monthly_cap integer,
  add column if not exists downgrade_to_email boolean not null default true;

-- ── Atomic spend increment ───────────────────────────────────────────────────
-- The worker calls this once per successful SMS send. Doing the upsert-and-add
-- in one statement makes the counter correct under concurrent sends without a
-- read-modify-write race in application code. period_start is the user-LOCAL day
-- (the caller computes it in the user's timezone) so caps roll over at local
-- midnight, not UTC.
create or replace function increment_notification_spend(
  p_user_id uuid,
  p_channel text,
  p_period_start date,
  p_cost_micros bigint default 0
) returns void language sql as $$
  insert into notification_spend (user_id, channel, period_start, sent_count, cost_micros, updated_at)
  values (p_user_id, p_channel, p_period_start, 1, p_cost_micros, now())
  on conflict (user_id, channel, period_start) do update
    set sent_count = notification_spend.sent_count + 1,
        cost_micros = notification_spend.cost_micros + excluded.cost_micros,
        updated_at = now();
$$;
