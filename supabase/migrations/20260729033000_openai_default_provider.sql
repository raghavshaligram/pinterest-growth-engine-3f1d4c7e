-- Switch the default image-generation provider from Replicate (Nano
-- Banana) to OpenAI, app-wide. Both providers remain fully supported
-- and selectable per-site in Sites -> brand settings -- this only
-- changes which one new sites start on, and backfills existing sites
-- to match.
--
-- The backfill is a deliberate choice, not an oversight: the
-- image_provider column (and its Sites UI selector) only shipped
-- earlier today, so any site currently stored as 'replicate' is
-- overwhelmingly likely to be an inherited column default rather than
-- a considered choice made through the UI. This DOES include
-- HarvestMath, which was mid-comparison-testing between providers at
-- the time this shipped -- if that comparison needs to continue on
-- Replicate specifically, flip it back manually in Sites afterward.
ALTER TABLE public.sites
  ALTER COLUMN image_provider SET DEFAULT 'openai';

UPDATE public.sites
  SET image_provider = 'openai'
  WHERE image_provider = 'replicate';

NOTIFY pgrst, 'reload schema';
