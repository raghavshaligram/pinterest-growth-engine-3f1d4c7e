-- Fixes a real bug: "Skip setup" and finishing the wizard both wrote the
-- SAME has_completed_onboarding=true flag, and the app then treated that
-- one flag as if it meant "onboarding is genuinely done." It doesn't --
-- it only ever meant "the user dismissed the forced redirect," and
-- conflating the two is why the Finish-setup banner and the wizard's own
-- resume logic couldn't tell "actually done" apart from "just skipped."
--
-- dismissed_onboarding_prompt is the one thing that must be persisted
-- (an explicit user action, not derivable from data) and is now the
-- ONLY thing gating the forced auto-redirect. "Genuinely done" is
-- computed live from real data every time instead (see
-- src/lib/onboarding.functions.ts:getSetupStatus's isFullyOnboarded),
-- so it can never drift from what's actually true the way a
-- write-once flag can.
ALTER TABLE public.account_onboarding
  ADD COLUMN IF NOT EXISTS dismissed_onboarding_prompt boolean NOT NULL DEFAULT false;

-- Backfill: every row written before this fix had has_completed_onboarding
-- set to true by BOTH "finished" and "skipped" (the bug), so there's no
-- way to perfectly reconstruct intent from that column alone. Backfilling
-- true wherever either signal is present is safe either way -- for a
-- row that really did finish, dismissed_onboarding_prompt being true is
-- inert (isFullyOnboarded is computed from real data, not this flag);
-- for a row that only skipped, this is exactly the correct value.
UPDATE public.account_onboarding
  SET dismissed_onboarding_prompt = true
  WHERE has_completed_onboarding = true OR skipped_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
