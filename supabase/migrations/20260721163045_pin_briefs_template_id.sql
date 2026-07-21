-- Persists the content-aware classifier's shape decision per brief.
--
-- Previously the shape (template_id) was re-derived every time via a
-- style-label regex (resolveTemplateId) -- both at generation time and
-- again later when image-worker.server.ts re-renders. Now that
-- generateBriefs asks the LLM to pick a template_id directly from the
-- full 11-shape SHAPE_REGISTRY (see briefs.functions.ts), that decision
-- needs to be stored so image-worker reuses the SAME shape later
-- instead of falling back to the much narrower 6-shape regex, which
-- would silently downgrade any brief classified into one of the 5
-- newly-reachable shapes back to a regex-only bucket on next render.
--
-- Nullable: existing briefs generated before this column existed have
-- no stored decision. image-worker.server.ts falls back to the
-- style-label regex only for those legacy rows.
ALTER TABLE public.pin_briefs ADD COLUMN IF NOT EXISTS template_id text;

NOTIFY pgrst, 'reload schema';
