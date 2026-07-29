-- Multi-account Pinterest connections -- mirrors google_connections'
-- shape/reasoning exactly (see 20260730100000_google_analytics_integration.sql):
-- the existing `integrations` table is UNIQUE(user_id, provider), one row
-- per provider per user, which is the confirmed root cause of the site-
-- isolation bug reported against Pinterest (a brand-new site showed
-- "Connected" with another site's real boards, because Pinterest status
-- was read from that single account-wide row rather than anything
-- per-site). Dedicated table, same as Google, so a user can hold several
-- independent Pinterest connections (their own, a client's, another
-- client's) and map each site to its own specific one.
--
-- Deliberately additive, not a replacement: the existing `integrations`
-- row (provider='pinterest') is left completely untouched by this
-- migration. Actual publish-time token resolution (publisher.server.ts's
-- makePinterestClient) and board syncing (boards.functions.ts's
-- syncPinterestBoards) still read that single row unchanged -- rewiring
-- the publish pipeline itself to resolve per-site via
-- pinterest_connection_id is a larger, separate change (which board maps
-- to which connection when a board's site_ids spans multiple sites with
-- different connections needs its own design), out of this pass's scope.
-- This migration only adds the table + the per-site mapping column that
-- the new Connections-card UI reads/writes.
CREATE TABLE public.pinterest_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- User-editable ("My account" / "Client A"), same pattern as
  -- google_connections.label -- defaults to the connected account's own
  -- Pinterest username at connect time when available (best-effort; the
  -- lazy backfill of the pre-existing single connection can't call
  -- Pinterest's API safely, so it falls back to a generic label there).
  label text NOT NULL DEFAULT 'Pinterest account',
  pinterest_username text,
  token_ciphertext text NOT NULL,
  -- Plain (unencrypted) column, deliberately queryable in SQL -- the
  -- proactive background refresh job (cron/pinterest-token-refresh.ts)
  -- selects "refresh_token_expires_at < now() + interval '7 days'"
  -- directly, without needing to decrypt every row's ciphertext just to
  -- check expiry. google_connections has no equivalent column because
  -- nothing proactively refreshes Google tokens today (only the lazy
  -- getValidAccessToken check-on-use) -- Pinterest's refresh token can
  -- go stale from inactivity within ~60 days per Pinterest's own policy,
  -- which is what this column and its background job exist to prevent.
  refresh_token_expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pinterest_connections ENABLE ROW LEVEL SECURITY;

-- Read-only for the authenticated user, same shape as `integrations` and
-- `google_connections` -- every write (connect, rename, disconnect,
-- token refresh) goes through the service-role client server-side,
-- never the user's own session.
CREATE POLICY "own pinterest connections readable" ON public.pinterest_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

GRANT ALL ON public.pinterest_connections TO service_role;
GRANT SELECT ON public.pinterest_connections TO authenticated;

-- Per-site mapping: which specific Pinterest connection this site
-- belongs to. NULL by default for every new site (same as
-- sites.google_connection_id) -- a site only shows "Connected" once
-- something (a user action, or the one-time lazy backfill of the
-- pre-existing single connection) explicitly sets this. ON DELETE SET
-- NULL (not CASCADE) -- disconnecting a Pinterest connection shouldn't
-- delete the site, just clear its mapping so its Connections card can
-- show "Not connected" and let the user re-pick.
ALTER TABLE public.sites
  ADD COLUMN pinterest_connection_id uuid REFERENCES public.pinterest_connections(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
