-- Per-site logo placement within the LOCKED LAYOUT's footer zone.
-- 'bottom-center' matches what the original (prompt-only) logo
-- compositing attempt described ("centered within this bar"), so this
-- default preserves that visual result for any site that already had
-- display_mode='logo' set before this column existed.
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS logo_placement text NOT NULL DEFAULT 'bottom-center'
  CHECK (logo_placement IN ('bottom-left', 'bottom-center', 'bottom-right'));

NOTIFY pgrst, 'reload schema';
