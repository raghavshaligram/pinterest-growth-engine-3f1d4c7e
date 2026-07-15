ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS brand_name text,
  ADD COLUMN IF NOT EXISTS brand_colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS brand_font text,
  ADD COLUMN IF NOT EXISTS brand_notes text;