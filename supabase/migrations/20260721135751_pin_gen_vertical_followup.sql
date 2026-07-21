-- Follow-up to 20260721131336_pin_gen_vertical_and_rotation.sql, which
-- failed to apply in full (its ADD COLUMN vertical + enum type never
-- landed -- see the "column sites_2.vertical does not exist" runtime
-- error). Lovable separately patched the two columns that were actively
-- breaking queries (sites.vertical as plain text, pages/sites.recent_styles
-- as jsonb) via 20260721135232_*.sql and 20260721135313_*.sql. This
-- migration fills in the two pieces that patch never covered because
-- nothing had exercised them yet: the vertical auto-derivation trigger,
-- and pin_briefs.image_prompt_edited_at entirely.
--
-- Written against the schema as it actually exists now (vertical is
-- plain text, not an enum) rather than re-attempting the original enum
-- approach, to avoid another silent full-file rollback.

-- ============ SITES.VERTICAL: backfill + auto-derivation ============
-- Existing rows never got backfilled (Lovable's patch just added the
-- column with no default/UPDATE) -- the app already defaults a NULL
-- vertical to 'garden_content' in JS (buildThemedPinPrompt), so nothing
-- was visibly broken, but pin it explicitly at the DB level too so
-- nothing depends on that JS fallback alone.
UPDATE public.sites SET vertical = 'garden_content' WHERE vertical IS NULL;

CREATE OR REPLACE FUNCTION public.tg_sites_default_vertical()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.vertical IS NULL THEN
    NEW.vertical := CASE NEW.site_type
      WHEN 'etsy' THEN 'etsy_product'
      WHEN 'ecomm' THEN 'ecomm_product'
      ELSE 'general_content'
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sites_default_vertical ON public.sites;
CREATE TRIGGER trg_sites_default_vertical
  BEFORE INSERT ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.tg_sites_default_vertical();

-- ============ PIN_BRIEFS.IMAGE_PROMPT_EDITED_AT ============
-- This never landed at all -- image-worker.server.ts's edited-prompt
-- check (briefRow.image_prompt_edited_at) has been silently a no-op
-- until now (falsy/undefined, so it always fell through to the normal
-- re-derivation path -- not a crash, just an incomplete feature).
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
