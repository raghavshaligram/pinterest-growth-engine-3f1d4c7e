ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS pin_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS site_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS boards_user_pinterest_uk
  ON public.boards(user_id, pinterest_board_id)
  WHERE pinterest_board_id IS NOT NULL;