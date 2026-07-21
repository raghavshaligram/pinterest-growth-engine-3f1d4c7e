-- Adds a real "failed" state to brief_status so a brief whose image
-- generation job errored out (Replicate failure, storage upload error,
-- etc.) is visibly distinct from one that's still queued/rendering.
--
-- Before this, image-worker.server.ts's failure path only updated the
-- jobs row (status='failed', last_error) and left pin_briefs.status
-- untouched at 'image_pending' -- so a brief whose render had already
-- failed looked identical, forever, to one still in progress ("Waiting
-- to render...") with no way to tell the two apart from the UI.
ALTER TYPE public.brief_status ADD VALUE IF NOT EXISTS 'failed';

NOTIFY pgrst, 'reload schema';
