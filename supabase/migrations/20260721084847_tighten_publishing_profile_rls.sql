-- Tighten account_publishing_profiles / account_cap_events RLS to
-- read-only for authenticated users. Every write to either table
-- already goes through the service-role client (supabaseAdmin) in
-- publishing-profile.server.ts / weekly-tier-check.server.ts -- the app
-- never relies on the authenticated user's own Supabase session to
-- write these rows -- so this doesn't change any app behavior. It just
-- closes the gap where a signed-in user could otherwise write to their
-- own row directly (e.g. via the browser Supabase client), including
-- current_daily_cap, bypassing the weekly auto-tuning logic entirely.

DROP POLICY IF EXISTS "own profile" ON public.account_publishing_profiles;
REVOKE INSERT, UPDATE, DELETE ON public.account_publishing_profiles FROM authenticated;
CREATE POLICY "own profile readable" ON public.account_publishing_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert own cap events" ON public.account_cap_events;
REVOKE INSERT ON public.account_cap_events FROM authenticated;
