-- Adds a real typed site_type field (not inferred from the URL) --
-- this is what the Etsy/e-commerce adapter logic (planned separately)
-- will branch on for extraction rules and pin-generation mode.
-- Defaults existing rows to 'website', the only type the app supported
-- before this migration, so nothing already-connected changes behavior.
--
-- Also adds `tagline`, a short one-line brand description shown on the
-- My Sites cards -- separate from brand_notes, which stays the
-- long-form prompt-steering text used by pin/image generation.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS site_type text NOT NULL DEFAULT 'website'
    CHECK (site_type IN ('website', 'etsy', 'ecomm')),
  ADD COLUMN IF NOT EXISTS tagline text;
