-- Account-level publishing pace control. Two tables:
--
-- account_publishing_profiles: one row per user, created the first time
-- they answer the post-connect onboarding prompt (see
-- publishing-profile.functions.ts / settings.integrations.tsx). Stores
-- their self-reported Pinterest account age bucket plus whatever
-- pinterest_metrics we could pull back from Pinterest's own
-- /v5/user_account (board_count/pin_count/follower_count — Pinterest's
-- API does not expose an actual account-creation date, so reconciliation
-- is a heuristic sanity check against those counts, not a literal date
-- compare). reconciled_tier is what the nightly materializer (see
-- cron/materialize.ts) actually uses to size daily caps; it starts equal
-- to the self-report and only drifts if the metrics clearly disagree.
--
-- account_cap_events: append-only audit trail of onboarding + tier
-- reconciliation events, so a user (or us, debugging) can see why their
-- daily cap changed.

CREATE TABLE public.account_publishing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  self_reported_age_bucket text NOT NULL
    CHECK (self_reported_age_bucket IN ('new', 'warming', 'established')),
  reconciled_tier text NOT NULL
    CHECK (reconciled_tier IN ('new', 'warming', 'established')),
  pinterest_metrics jsonb,
  onboarded_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_publishing_profiles_user_id_idx ON public.account_publishing_profiles(user_id);
GRANT SELECT ON public.account_publishing_profiles TO authenticated;
GRANT ALL ON public.account_publishing_profiles TO service_role;
ALTER TABLE public.account_publishing_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own publishing profile readable" ON public.account_publishing_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- INSERT/UPDATE only via service role (server functions), same as integrations.

CREATE TABLE public.account_cap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('onboarded', 'reconciled', 'tier_changed')),
  from_tier text,
  to_tier text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_cap_events_user_id_idx ON public.account_cap_events(user_id, created_at DESC);
GRANT SELECT ON public.account_cap_events TO authenticated;
GRANT ALL ON public.account_cap_events TO service_role;
ALTER TABLE public.account_cap_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cap events readable" ON public.account_cap_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
