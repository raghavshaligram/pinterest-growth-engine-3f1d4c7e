-- Weekly cap-adjustment controls on top of account_publishing_profiles /
-- account_cap_events (see 20260722090000_account_publishing_profiles.sql).
--
--   current_daily_cap  — the actual maxPerAccountPerDay the nightly
--                        materializer uses (see
--                        publishing-profile.server.ts:getEffectiveLimits),
--                        fine-tuned weekly by cron/tier-check.ts on top
--                        of the coarser reconciled_tier.
--   cap_mode/manual_cap — lets a user take the wheel. When 'manual', the
--                        weekly job leaves current_daily_cap alone
--                        entirely and manual_cap is used instead.
--   last_cap_check_at  — when the weekly job last evaluated this
--                        account (shown on the Account Health card).
--
-- account_cap_events gets from_cap/to_cap so cap changes render cleanly
-- without unpacking detail jsonb, plus four new event_type values for
-- the weekly job's three triggers and the manual on/off toggle.

ALTER TABLE public.account_publishing_profiles
  ADD COLUMN IF NOT EXISTS current_daily_cap integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS cap_mode text NOT NULL DEFAULT 'auto' CHECK (cap_mode IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS manual_cap integer,
  ADD COLUMN IF NOT EXISTS last_cap_check_at timestamptz;

ALTER TABLE public.account_cap_events
  ADD COLUMN IF NOT EXISTS from_cap integer,
  ADD COLUMN IF NOT EXISTS to_cap integer;

ALTER TABLE public.account_cap_events DROP CONSTRAINT IF EXISTS account_cap_events_event_type_check;
ALTER TABLE public.account_cap_events ADD CONSTRAINT account_cap_events_event_type_check
  CHECK (event_type IN (
    'onboarded', 'reconciled', 'tier_changed',
    'age_growth', 'consistency_gap', 'api_error_brake', 'manual_override'
  ));
