-- Brand logo / display-mode settings, plus a per-site "Pin Style
-- Setup" completion gate.
--
-- logo_url stores a Supabase Storage PATH (not a public URL), same
-- convention as pin_images.storage_path -- resolved to a signed URL at
-- read/generation time (see sites.tsx's logo upload/preview and
-- image-worker.server.ts's compositing path). It lives under the
-- existing 'pins' storage bucket (path-prefixed `${user_id}/logos/...`)
-- so no new bucket or storage policy is needed -- the existing "own pin
-- images read/write" policies already scope on the first path segment
-- being auth.uid(), which a logos/ subfolder under the same user
-- prefix satisfies as-is.
--
-- display_mode/name_mode default to 'text'/'domain' -- today's actual
-- behavior (the URL bar has only ever rendered the bare domain) -- so
-- every existing site's live pin rendering is completely unaffected by
-- this migration on its own.
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS display_mode text NOT NULL DEFAULT 'text'
  CHECK (display_mode IN ('logo', 'text'));
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS name_mode text NOT NULL DEFAULT 'domain'
  CHECK (name_mode IN ('brand_name', 'domain'));

-- style_locked_at gates batch generation (see generateBriefs in
-- briefs.functions.ts, and the client-side useSiteStyleGate hook) --
-- NULL means "Pin Style Setup has never been completed for this site."
-- Deliberately no DEFAULT here: a fresh INSERT (a brand-new site) should
-- land on NULL and be gated, which is the entire point of this column.
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS style_locked_at timestamptz;

-- Grandfather every site that already existed before this feature
-- shipped -- this is a ONE-TIME backfill of current rows, not a
-- column default, so it never touches sites created after this
-- statement runs. Without this, every pre-existing site (e.g.
-- HarvestMath) would suddenly be unable to generate new pins until
-- someone ran Pin Style Setup retroactively, which is not the intent --
-- the gate is meant for sites that have never had a chance to confirm
-- their style, not every site that predates the feature.
UPDATE public.sites SET style_locked_at = now() WHERE style_locked_at IS NULL;

NOTIFY pgrst, 'reload schema';
