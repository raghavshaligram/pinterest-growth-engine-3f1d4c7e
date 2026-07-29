-- Multi-account Google Analytics integration. Deliberately a dedicated
-- table, NOT a row in the existing `integrations` table -- integrations
-- is UNIQUE(user_id, provider), one row per provider per user by design
-- (see saveIntegration's onConflict: "user_id,provider" in
-- integrations.functions.ts), which is exactly the single-account
-- limitation this feature exists to avoid. Google is agency-facing from
-- day one: one Pinspider user can connect several Google accounts
-- (their own, a client's, another client's) and map different sites to
-- different ones.
--
-- Same encryption pattern as every other BYOK credential in this app
-- (AES-256-GCM via src/lib/crypto.server.ts, keyed off
-- INTEGRATIONS_ENC_KEY) -- token_ciphertext holds a JSON blob of
-- {access_token, refresh_token, expires_at}, decrypted only in-process,
-- server-side, never returned to the client.
CREATE TABLE public.google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- User-editable ("My account" / "Client A") -- defaults to the
  -- connected Google account's own email at connect time (see
  -- google.functions.ts:startGoogleOAuth's userinfo.email scope) so
  -- there's a meaningful label even before the user renames it.
  label text NOT NULL DEFAULT 'Google account',
  google_email text,
  token_ciphertext text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

-- Read-only for the authenticated user, same shape as `integrations` --
-- every write (connect, rename, disconnect, token refresh) goes through
-- the service-role client server-side, never the user's own session.
CREATE POLICY "own google connections readable" ON public.google_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

GRANT ALL ON public.google_connections TO service_role;
GRANT SELECT ON public.google_connections TO authenticated;

-- Per-site GA4 mapping: which connected Google account, and which GA4
-- property under that account, this site's Insights page should query.
-- ON DELETE SET NULL (not CASCADE) -- disconnecting a Google account
-- shouldn't silently delete a site, just leave its GA mapping empty so
-- the Connections card can show "not connected" and let the user
-- re-pick.
ALTER TABLE public.sites
  ADD COLUMN google_connection_id uuid REFERENCES public.google_connections(id) ON DELETE SET NULL,
  ADD COLUMN ga4_property_id text,
  -- Cached display name (e.g. "harvestmath.com - GA4") from the Admin
  -- API property picker at selection time, so the Connections card and
  -- Insights page header can show a human name without an extra Admin
  -- API round-trip on every load.
  ADD COLUMN ga4_property_label text;

NOTIFY pgrst, 'reload schema';
