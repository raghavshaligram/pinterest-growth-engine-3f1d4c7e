ALTER TABLE public.pin_briefs
  ADD COLUMN IF NOT EXISTS intent text NOT NULL DEFAULT 'informational';

ALTER TABLE public.pin_briefs
  ADD CONSTRAINT pin_briefs_intent_check
  CHECK (intent IN ('informational','tool','list','commercial'));