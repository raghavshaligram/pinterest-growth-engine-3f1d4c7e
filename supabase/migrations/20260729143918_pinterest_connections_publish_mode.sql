-- Moves publish_mode/webhook_url onto pinterest_connections (per-
-- connection), not sites. Decision, not a default: publish_mode
-- describes HOW a specific Pinterest account's pins go out -- direct
-- API using that connection's own OAuth token, or routed through that
-- connection's own webhook automation -- which is a property of the
-- account/connection itself, not of whichever site happens to be mapped
-- to it. If two sites shared one Pinterest connection, having each site
-- independently choose "api" vs "webhook" for what is ultimately the
-- exact same downstream Pinterest account would be incoherent. This
-- mirrors how GA4's connection already owns its own account-level
-- mechanics while sites just pick which connection to use.
--
-- Every existing connection defaults to 'api' -- matches PinterestConfig's
-- own existing default in integrations.server.ts, and the lazy backfill
-- (pinterest-connections.server.ts) now carries the real prior value
-- over from the legacy integrations row when one exists, rather than
-- silently resetting anyone who was already on webhook mode back to api.
ALTER TABLE public.pinterest_connections
  ADD COLUMN publish_mode text NOT NULL DEFAULT 'api' CHECK (publish_mode IN ('api', 'webhook')),
  ADD COLUMN webhook_url text;

NOTIFY pgrst, 'reload schema';
