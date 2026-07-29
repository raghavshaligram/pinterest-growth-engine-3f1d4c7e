-- Backs the first-time-user onboarding wizard / skip-banner / empty-state
-- Dashboard (see src/lib/onboarding.functions.ts, the single shared
-- "setup steps" definition all three surfaces read from). This table
-- only stores the one thing that can't be derived by re-querying real
-- data on every load -- whether the wizard's auto-redirect-on-first-
-- login has already fired for this account -- not step completion
-- itself, which is always computed live from sites/integrations/
-- pin_images (see getSetupStatus) so it can never drift out of sync
-- with what's actually true.
--
-- has_completed_onboarding is set true either by finishing the wizard's
-- last step, or by clicking "Skip setup" -- both stop the forced
-- redirect; skipping just means the "Finish setup" banner keeps showing
-- (computed live, not from this flag) until the required steps are
-- actually done.
CREATE TABLE public.account_onboarding (
  user_id uuid PRIMARY KEY,
  has_completed_onboarding boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_onboarding ENABLE ROW LEVEL SECURITY;

-- Same "own row, full CRUD" shape as sites/pages -- this is ordinary
-- account preference data the signed-in user is expected to write
-- directly (unlike account_publishing_profiles, which is service-role-
-- only because it drives anti-spam publishing caps).
CREATE POLICY "own onboarding state" ON public.account_onboarding FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
