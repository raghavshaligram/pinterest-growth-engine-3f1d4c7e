-- Structural refactor support for multi-vertical pin generation.
-- See src/lib/briefs.functions.ts (template registry) and
-- src/lib/image-worker.server.ts for the code that reads these columns.

-- ============ SITES.VERTICAL ============
-- Drives which template-registry family (garden_content/general_content/
-- etsy_product/ecomm_product) buildThemedPinPrompt() picks for a site.
DO $$ BEGIN
  CREATE TYPE public.site_vertical AS ENUM (
    'garden_content', 'general_content', 'etsy_product', 'ecomm_product'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-derive vertical from site_type on insert when not explicitly set,
-- same pattern as the existing accent-color-cycling trigger
-- (tg_sites_assign_accent_color). etsy/ecomm map to their dedicated
-- verticals; plain "website" sites default to the neutral
-- general_content vertical going forward (NOT garden_content -- that
-- was only ever correct because every pre-vertical site happened to be
-- gardening content; see the explicit backfill below for those rows).
CREATE OR REPLACE FUNCTION public.tg_sites_default_vertical()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.vertical IS NULL THEN
    NEW.vertical := CASE NEW.site_type
      WHEN 'etsy' THEN 'etsy_product'::public.site_vertical
      WHEN 'ecomm' THEN 'ecomm_product'::public.site_vertical
      ELSE 'general_content'::public.site_vertical
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sites_default_vertical ON public.sites;
CREATE TRIGGER trg_sites_default_vertical
  BEFORE INSERT ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.tg_sites_default_vertical();

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS vertical public.site_vertical;

-- Every site that existed before this migration is HarvestMath-style
-- gardening content -- pin them explicitly to garden_content so the
-- registry-driven prompt is byte-identical to today's hardcoded output.
-- (Deliberately overrides what the trigger's site_type-based derivation
-- would otherwise assign, per the task spec.)
UPDATE public.sites SET vertical = 'garden_content' WHERE vertical IS NULL;

ALTER TABLE public.sites ALTER COLUMN vertical SET NOT NULL;

-- ============ STYLE ROTATION MEMORY ============
-- Lightweight rolling history (last 5 styles used) so brief generation
-- can deprioritize immediate repeats. Page-level is primary; site-level
-- is the fallback when a page's own history is too sparse (e.g. first
-- batch, or very few briefs generated so far for that page).
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS recent_styles text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS recent_styles text[] NOT NULL DEFAULT '{}';

-- ============ PIN_BRIEFS.IMAGE_PROMPT_EDITED_AT ============
-- Set automatically whenever image_prompt is changed after the initial
-- insert (regardless of which future code path performs the edit), so
-- the image worker can tell a manually-edited, already-final prompt
-- apart from the original AI-drafted "middle prompt" that still needs
-- buildThemedPinPrompt's theme wrapper applied.
ALTER TABLE public.pin_briefs ADD COLUMN IF NOT EXISTS image_prompt_edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_pin_briefs_track_image_prompt_edit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.image_prompt IS DISTINCT FROM OLD.image_prompt THEN
    NEW.image_prompt_edited_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pin_briefs_image_prompt_edit ON public.pin_briefs;
CREATE TRIGGER trg_pin_briefs_image_prompt_edit
  BEFORE UPDATE ON public.pin_briefs
  FOR EACH ROW EXECUTE FUNCTION public.tg_pin_briefs_track_image_prompt_edit();

NOTIFY pgrst, 'reload schema';
