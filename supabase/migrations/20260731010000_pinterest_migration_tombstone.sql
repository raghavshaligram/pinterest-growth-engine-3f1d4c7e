-- Tombstones completion of the legacy-integrations -> pinterest_connections
-- backfill independently of whether any pinterest_connections row
-- currently exists. Without this, backfillLegacyConnectionIfNeeded's old
-- guard ("does a pinterest_connections row exist for this user") is
-- indistinguishable from "has this user ever been migrated": disconnecting
-- a user's LAST connection legitimately drops their row count back to
-- zero, and the never-deleted legacy `integrations` row (kept only as
-- historical data, see pinterest-connections.server.ts) then reads as
-- "not migrated yet" again, silently recreating an equivalent connection
-- on the very next read.
--
-- Named pinterest_migrated_at (not a generic migrated_at) because
-- `integrations` is a shared, multi-provider table -- this column only
-- has meaning for the provider='pinterest' row.
ALTER TABLE public.integrations
  ADD COLUMN pinterest_migrated_at timestamptz;

NOTIFY pgrst, 'reload schema';
