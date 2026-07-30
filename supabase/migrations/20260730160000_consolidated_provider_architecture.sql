-- Consolidated Image Generation / Copy Generation provider architecture.
--
-- 1. integration_provider is a real Postgres ENUM (not a plain text
--    CHECK) -- see 20260715124417_bc89e263-...sql's original
--    CREATE TYPE. Adding 6 new provider values for it. Each ADD VALUE
--    must not be used elsewhere in the SAME transaction/statement batch
--    it's added in (a Postgres restriction on new enum labels) -- this
--    file only adds labels, it never references them in a query, so
--    running the whole file in one paste is safe. If your SQL editor
--    still errors on these lines specifically, run just the 6
--    ALTER TYPE lines below first, then the rest of this file
--    separately.
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'fal';
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'gemini';
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'ideogram';
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'recraft';
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'stability';
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'anthropic';

-- 2. sites.image_provider grows from 2 to 7 allowed values.
ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_image_provider_check;
ALTER TABLE public.sites ADD CONSTRAINT sites_image_provider_check
  CHECK (image_provider IN ('replicate', 'openai', 'fal', 'gemini', 'ideogram', 'recraft', 'stability'));

-- 3. New per-site copy_provider column -- same reasoning/pattern as
--    image_provider (see 20260728194623_sites_image_provider.sql):
--    defaults to 'openai' so every existing site keeps generating pin
--    copy exactly the way it already does.
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS copy_provider text NOT NULL DEFAULT 'openai';
ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_copy_provider_check;
ALTER TABLE public.sites ADD CONSTRAINT sites_copy_provider_check
  CHECK (copy_provider IN ('openai', 'anthropic'));

NOTIFY pgrst, 'reload schema';
