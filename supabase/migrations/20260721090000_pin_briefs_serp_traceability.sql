-- Traceability for generateBriefs(): record whether a brief was
-- generated with the "what's currently working" competitive-pattern
-- block (see briefs.functions.ts / keywords.functions.ts), which keyword
-- it came from, and how fresh that snapshot was at generation time. Lets
-- the UI show a small "used competitive data" indicator per brief instead
-- of that being invisible after the fact.

ALTER TABLE public.pin_briefs
  ADD COLUMN IF NOT EXISTS used_serp_patterns boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS serp_keyword text,
  ADD COLUMN IF NOT EXISTS serp_patterns_captured_at timestamptz;
