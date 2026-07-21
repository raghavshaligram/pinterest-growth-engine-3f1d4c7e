-- Account-level publishing pace control (superseded two earlier,
-- never-applied migration files of the same tables -- this is the one
-- actually run against the live project, so it's the source of truth
-- going forward; the older files were removed to avoid a duplicate
-- CREATE TABLE on a fresh `supabase db push`).
--
-- account_publishing_profiles: one row per user (user_id itself is the
-- PK, FK'd to auth.users so it cascades on account deletion). Created
-- the first time a user answers the post-connect onboarding prompt
-- (see publishing-profile.functions.ts / settings.integrations.tsx).
-- reconciled_tier is what the nightly materializer actually sizes daily
-- caps from (see publishing-profile.server.ts:getEffectiveLimits);
-- current_daily_cap/cap_mode/manual_cap are the weekly-tuning controls
-- on top of that (cron/tier-check.ts).
--
-- account_cap_events: append-only audit trail of onboarding/tier/cap
-- changes, surfaced on the Account Health card and folded into the
-- Dashboard activity feed (dashboard.functions.ts).
--
-- Note: every write to both tables goes through the service-role client
-- (supabaseAdmin) -- see publishing-profile.server.ts and
-- weekly-tier-check.server.ts -- server-side code never relies on the
-- permissive "FOR ALL" policy below to write on the user's behalf. That
-- policy currently lets an authenticated user write their own row
-- directly too (e.g. via the browser Supabase client), which is wider
-- than the app's own code path needs -- worth tightening to
-- SELECT-only-for-authenticated (writes via service role) in a follow-up
-- if you want the weekly auto-tuning to be the only thing that can move
-- current_daily_cap.

CREATE TABLE public.account_publishing_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  self_reported_age_bucket text,
  reconciled_tier text NOT NULL DEFAULT 'new',
  pinterest_metrics jsonb,
  reconciled_at timestamptz,
  current_daily_cap integer NOT NULL DEFAULT 5,
  manual_cap integer,
  cap_mode text NOT NULL DEFAULT 'auto',
  onboarded_at timestamptz NOT NULL DEFAULT now(),
  last_cap_check_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_publishing_profiles TO authenticated;
GRANT ALL ON public.account_publishing_profiles TO service_role;
ALTER TABLE public.account_publishing_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.account_publishing_profiles FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.account_publishing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.account_cap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_tier text,
  to_tier text,
  from_cap integer,
  to_cap integer,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_cap_events_user_created_idx ON public.account_cap_events(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.account_cap_events TO authenticated;
GRANT ALL ON public.account_cap_events TO service_role;
ALTER TABLE public.account_cap_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cap events" ON public.account_cap_events FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "insert own cap events" ON public.account_cap_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);
