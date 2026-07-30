-- Reverts the brand logo / display-mode feature entirely. Brand
-- display goes back to plain text/domain only (the original, and only
-- ever shipped, live behavior -- display_mode/name_mode never actually
-- changed what real generated pins looked like, since 'text'/'domain'
-- was the default for every site the whole time this feature existed).
--
-- style_locked_at is intentionally NOT touched here -- Pin Style Setup
-- (the brand-lock-in gate on batch generation) is a separate feature
-- that outlives this revert; only the logo/display-specific columns
-- go away.
ALTER TABLE public.sites DROP COLUMN IF EXISTS logo_url;
ALTER TABLE public.sites DROP COLUMN IF EXISTS display_mode;
ALTER TABLE public.sites DROP COLUMN IF EXISTS name_mode;
ALTER TABLE public.sites DROP COLUMN IF EXISTS logo_placement;

NOTIFY pgrst, 'reload schema';
