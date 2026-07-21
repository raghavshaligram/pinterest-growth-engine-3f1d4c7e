DO $$ BEGIN
  CREATE TYPE public.site_type AS ENUM ('website', 'etsy', 'ecomm');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS site_type public.site_type NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS tagline text;