-- Per-site accent color for the light-theme redesign's site switcher and
-- pin-thumbnail tinting. Auto-assigned by cycling through a fixed palette
-- so existing sites (created before this migration) and future ones both
-- get a stable, deterministic color without any application-code changes
-- to sites.functions.ts.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS accent_color text;

CREATE OR REPLACE FUNCTION public.tg_sites_assign_accent_color()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  palette text[] := ARRAY['#4F7A5C', '#8067AD', '#C68A4B', '#4A6C93'];
  existing_count int;
BEGIN
  IF NEW.accent_color IS NULL THEN
    SELECT count(*) INTO existing_count FROM public.sites WHERE user_id = NEW.user_id;
    NEW.accent_color := palette[(existing_count % array_length(palette, 1)) + 1];
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sites_accent_color
  BEFORE INSERT ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.tg_sites_assign_accent_color();

-- Backfill: assign colors to pre-existing rows in created_at order per
-- user, so a user's sites keep a stable, non-repeating cycle same as new
-- inserts would get.
WITH ranked AS (
  SELECT id, user_id, row_number() OVER (PARTITION BY user_id ORDER BY created_at) - 1 AS rn
  FROM public.sites
  WHERE accent_color IS NULL
)
UPDATE public.sites s
SET accent_color = (ARRAY['#4F7A5C', '#8067AD', '#C68A4B', '#4A6C93'])[(ranked.rn % 4) + 1]
FROM ranked
WHERE s.id = ranked.id;
