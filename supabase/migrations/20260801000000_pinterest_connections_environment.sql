-- Adds environment ('sandbox' | 'production') and token_source
-- ('oauth' | 'manual') to pinterest_connections, so the app can support
-- Pinterest's Trial-access Sandbox (https://api-sandbox.pinterest.com)
-- alongside production (https://api.pinterest.com) instead of hard-
-- coding the production host everywhere. Confirmed against Pinterest's
-- own docs (developers.pinterest.com/docs/developer-tools/sandbox/):
-- Sandbox entities, tokens, and API calls are entirely separate from
-- production -- a token issued for one environment is rejected by the
-- other, which is exactly why both columns need to travel together with
-- every stored connection rather than being inferred.
--
-- NOT NULL DEFAULT backfills every existing row to production/oauth in
-- the same statement that adds the column -- every connection that
-- exists today was created through the real OAuth flow against the
-- production host, so this default is not a guess, it's simply what
-- was already true before these columns existed.
ALTER TABLE public.pinterest_connections
  ADD COLUMN environment text NOT NULL DEFAULT 'production',
  ADD COLUMN token_source text NOT NULL DEFAULT 'oauth';

ALTER TABLE public.pinterest_connections
  ADD CONSTRAINT pinterest_connections_environment_check CHECK (environment IN ('sandbox', 'production')),
  ADD CONSTRAINT pinterest_connections_token_source_check CHECK (token_source IN ('oauth', 'manual'));

-- No RLS changes needed or made: RLS in Postgres is row-level, not
-- column-level, so the existing "own pinterest connections readable"
-- SELECT policy (auth.uid() = user_id) from the table's original
-- migration (20260729141929_pinterest_connections.sql) automatically
-- covers these two new columns with no changes required. Not re-
-- declaring or touching that policy here on purpose, so there's no risk
-- of this migration accidentally narrowing or widening it.

NOTIFY pgrst, 'reload schema';
