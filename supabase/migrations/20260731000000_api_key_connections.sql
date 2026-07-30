-- Multi-connection model for API-key-based generation providers
-- (OpenAI, Replicate, fal.ai, Google Gemini, Ideogram, Recraft,
-- Stability AI, Anthropic) -- extends the same multi-row pattern
-- already built for Pinterest (pinterest_connections) and Google
-- (google_connections) to these credential-only providers, so a user
-- can hold several keys for the SAME provider (e.g. two separate
-- OpenAI keys for two different clients), not just one key per
-- provider like the old `integrations` table (UNIQUE(user_id,
-- provider)) allowed.
--
-- Deliberately its own table, not a widening of `integrations` itself
-- -- `integrations` stays exactly as-is and keeps serving Apify and
-- Pinterest's legacy single-account OAuth row, both explicitly out of
-- scope here (Apify has no per-client-key use case; Pinterest already
-- has its own dedicated multi-connection table). Only the 8 providers
-- surfaced in the consolidated Image Generation / Copy Generation
-- cards move to this table.
--
-- config_ciphertext reuses the exact same AES-256-GCM scheme
-- (crypto.server.ts) and JSON-blob shape ({api_key: "..."} or
-- {api_token: "..."} for Replicate) every other BYOK credential in
-- this app already uses -- which is what makes the backfill below a
-- plain ciphertext COPY, no decrypt/re-encrypt round-trip needed.
CREATE TABLE IF NOT EXISTS public.api_key_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider public.integration_provider NOT NULL,
  -- User-editable ("My key" / "Client A's key") -- same pattern as
  -- pinterest_connections.label / google_connections.label. Defaults
  -- to "My key" since that's what every migrated pre-existing key
  -- becomes below.
  label text NOT NULL DEFAULT 'My key',
  config_ciphertext text NOT NULL,
  status public.integration_status NOT NULL DEFAULT 'unconfigured',
  last_used_at timestamptz,
  last_error text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_key_connections_provider_check
    CHECK (provider IN ('openai','replicate','fal','gemini','ideogram','recraft','stability','anthropic'))
);
CREATE INDEX IF NOT EXISTS idx_api_key_connections_user_provider ON public.api_key_connections(user_id, provider);

ALTER TABLE public.api_key_connections ENABLE ROW LEVEL SECURITY;
-- Read-only for the authenticated user, same shape as `integrations` /
-- `pinterest_connections` / `google_connections` -- every write
-- (add, rename, rotate, test, delete) goes through the service-role
-- client server-side, so ciphertext never leaves the server via a
-- client-issued write either.
DROP POLICY IF EXISTS "own api key connections readable" ON public.api_key_connections;
CREATE POLICY "own api key connections readable" ON public.api_key_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT ALL ON public.api_key_connections TO service_role;
GRANT SELECT ON public.api_key_connections TO authenticated;

-- Backfill: every user's existing single-row-per-provider key
-- (integrations table) becomes that provider's first labeled
-- connection, "My key" -- ciphertext copied as-is (same encryption
-- scheme, same JSON shape), so no one's working key is touched,
-- re-encrypted, or lost. Guarded with NOT EXISTS so pasting this file
-- twice can't create duplicate connections.
INSERT INTO public.api_key_connections
  (user_id, provider, label, config_ciphertext, status, last_used_at, last_error, connected_at, updated_at)
SELECT i.user_id, i.provider, 'My key', i.config_ciphertext, i.status, i.last_used_at, i.last_error, i.created_at, i.updated_at
FROM public.integrations i
WHERE i.provider IN ('openai','replicate','fal','gemini','ideogram','recraft','stability','anthropic')
  AND NOT EXISTS (
    SELECT 1 FROM public.api_key_connections akc
    WHERE akc.user_id = i.user_id AND akc.provider = i.provider
  );

-- ============ Account-level default now points at a specific connection ============
-- "account default: OpenAI" becomes "account default: OpenAI (My
-- key)" -- the default is a specific connection, not just a provider
-- name, so two accounts (or two providers on the same account) can
-- each default to their own distinct key.
ALTER TABLE public.account_provider_defaults
  ADD COLUMN IF NOT EXISTS default_image_connection_id uuid REFERENCES public.api_key_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_copy_connection_id uuid REFERENCES public.api_key_connections(id) ON DELETE SET NULL;

-- Backfill from the old provider-name default to whichever connection
-- the row above just became for that (user, provider) pair. If a
-- user's default_image_provider was 'openai' but they never actually
-- saved an OpenAI key (no integrations row ever existed), this join
-- finds nothing and the column stays NULL -- correct, since there's
-- genuinely no connection to default to yet, rather than inventing one.
UPDATE public.account_provider_defaults apd
SET default_image_connection_id = akc.id
FROM public.api_key_connections akc
WHERE akc.user_id = apd.user_id AND akc.provider = apd.default_image_provider::public.integration_provider
  AND apd.default_image_connection_id IS NULL;

UPDATE public.account_provider_defaults apd
SET default_copy_connection_id = akc.id
FROM public.api_key_connections akc
WHERE akc.user_id = apd.user_id AND akc.provider = apd.default_copy_provider::public.integration_provider
  AND apd.default_copy_connection_id IS NULL;

-- Old provider-name defaults are now fully superseded -- drop them
-- (their CHECK constraints go with them automatically).
ALTER TABLE public.account_provider_defaults DROP COLUMN IF EXISTS default_image_provider;
ALTER TABLE public.account_provider_defaults DROP COLUMN IF EXISTS default_copy_provider;

-- ============ Per-site override now points at a specific connection ============
-- A site's override can now pin "OpenAI (Client A's key)" specifically
-- -- distinct from another site pinned to "OpenAI (My key)" -- rather
-- than just naming a provider.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS image_connection_override_id uuid REFERENCES public.api_key_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS copy_connection_override_id uuid REFERENCES public.api_key_connections(id) ON DELETE SET NULL;

-- Backfill: every existing site's current image_provider_override /
-- copy_provider_override (a provider NAME) is resolved to that site
-- OWNER's matching connection (their migrated "My key" row for that
-- provider) -- guaranteeing no site's effective provider silently
-- changes. A site whose override names a provider the owner never
-- actually connected (shouldn't happen given the prior migration's own
-- CHECK, but handled defensively) simply gets no connection override,
-- same fallback-to-account-default behavior as before.
UPDATE public.sites s
SET image_connection_override_id = akc.id
FROM public.api_key_connections akc
WHERE akc.user_id = s.user_id AND akc.provider = s.image_provider_override::public.integration_provider
  AND s.image_provider_override IS NOT NULL AND s.image_connection_override_id IS NULL;

UPDATE public.sites s
SET copy_connection_override_id = akc.id
FROM public.api_key_connections akc
WHERE akc.user_id = s.user_id AND akc.provider = s.copy_provider_override::public.integration_provider
  AND s.copy_provider_override IS NOT NULL AND s.copy_connection_override_id IS NULL;

-- Old provider-name overrides are now fully superseded -- drop them
-- (their CHECK constraints go with them automatically).
ALTER TABLE public.sites DROP COLUMN IF EXISTS image_provider_override;
ALTER TABLE public.sites DROP COLUMN IF EXISTS copy_provider_override;

-- ============ Retire the old single-key rows for these 8 providers ============
-- Safe now that every remaining reader of `integrations` for these
-- providers has been rewired to api_key_connections in this same
-- patch (GenerationProviderRow/Card, provider-resolution.server.ts,
-- image-worker/briefs/pin-style-setup, AND the two account-level
-- OpenAI consumers outside pin generation -- keywords.functions.ts's
-- SERP-pattern summarizer and pages.functions.ts's page analyzer --
-- both now resolve via api_key_connections too, so nothing is left
-- silently reading a now-stale row here). `integrations` itself is
-- untouched otherwise -- Apify and Pinterest's legacy row remain.
DELETE FROM public.integrations
WHERE provider IN ('openai','replicate','fal','gemini','ideogram','recraft','stability','anthropic');

NOTIFY pgrst, 'reload schema';
