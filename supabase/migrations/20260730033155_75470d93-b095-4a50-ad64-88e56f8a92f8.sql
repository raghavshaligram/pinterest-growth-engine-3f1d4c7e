ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS display_mode text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS name_mode text NOT NULL DEFAULT 'domain',
  ADD COLUMN IF NOT EXISTS style_locked_at timestamp with time zone;