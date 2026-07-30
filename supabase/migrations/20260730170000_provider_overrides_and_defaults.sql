-- Per-site provider OVERRIDE + account-level provider DEFAULT.
--
-- Replaces sites.image_provider/copy_provider (NOT NULL, mandatory
-- per-site choice, from the consolidated-provider-architecture patch)
-- with a two-tier model: an account-wide default (new
-- account_provider_defaults table) that every site inherits unless it
-- explicitly sets its own override (new nullable
-- image_provider_override / copy_provider_override columns).

-- 1. Account-level defaults -- its own table, deliberately NOT bolted
--    onto account_publishing_profiles (see
--    account-provider-defaults.functions.ts's own comment for why:
--    that table's lifecycle is tied to Pinterest-onboarding/cap
--    reconciliation, an unrelated concern).
CREATE TABLE IF NOT EXISTS public.account_provider_defaults (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_image_provider text NOT NULL DEFAULT 'openai'
    CHECK (default_image_provider IN ('replicate','openai','fal','gemini','ideogram','recraft','stability')),
  default_copy_provider text NOT NULL DEFAULT 'openai'
    CHECK (default_copy_provider IN ('openai','anthropic')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_provider_defaults TO authenticated;
GRANT ALL ON public.account_provider_defaults TO service_role;
ALTER TABLE public.account_provider_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own provider defaults" ON public.account_provider_defaults;
CREATE POLICY "own provider defaults" ON public.account_provider_defaults FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.account_provider_defaults
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. Per-site override columns -- nullable; null means "inherit the
--    account default," a real value pins this specific site regardless
--    of what the account default is.
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS image_provider_override text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS copy_provider_override text;

-- 3. Backfill: every EXISTING site currently has an explicit
--    image_provider/copy_provider value (NOT NULL). To guarantee no
--    site's actual generation behavior silently changes the moment
--    this ships, every existing site's current value is copied into
--    the new override column -- every pre-existing site becomes an
--    explicit "pinned" site rather than "inherit account default,"
--    which is the safe choice: the alternative (clearing everyone to
--    null and guessing an account default from the most common value)
--    would silently switch the provider for any site that wasn't
--    already using that most-common value. Going forward, brand-new
--    sites land on override = null (inherit), which is the intended
--    default for the new model -- only pre-existing sites get this
--    one-time backfill.
UPDATE public.sites SET image_provider_override = image_provider WHERE image_provider_override IS NULL;
UPDATE public.sites SET copy_provider_override = copy_provider WHERE copy_provider_override IS NULL;

ALTER TABLE public.sites ADD CONSTRAINT sites_image_provider_override_check
  CHECK (image_provider_override IS NULL OR image_provider_override IN ('replicate','openai','fal','gemini','ideogram','recraft','stability'));
ALTER TABLE public.sites ADD CONSTRAINT sites_copy_provider_override_check
  CHECK (copy_provider_override IS NULL OR copy_provider_override IN ('openai','anthropic'));

-- 4. The old mandatory columns are now fully superseded -- drop them
--    (their CHECK constraints go with them automatically).
ALTER TABLE public.sites DROP COLUMN IF EXISTS image_provider;
ALTER TABLE public.sites DROP COLUMN IF EXISTS copy_provider;

NOTIFY pgrst, 'reload schema';
