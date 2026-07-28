ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS image_provider text NOT NULL DEFAULT 'replicate';

ALTER TABLE public.sites
  ADD CONSTRAINT sites_image_provider_check
  CHECK (image_provider IN ('replicate', 'openai'));

NOTIFY pgrst, 'reload schema';
