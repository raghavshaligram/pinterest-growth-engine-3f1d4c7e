ALTER TYPE brief_status ADD VALUE IF NOT EXISTS 'failed';
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS recent_styles jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS recent_styles jsonb NOT NULL DEFAULT '[]'::jsonb;