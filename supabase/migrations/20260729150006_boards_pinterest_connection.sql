-- Tags each synced board with which Pinterest connection actually
-- produced it -- the follow-up gap flagged when the Pinterest publish
-- pipeline was rewired to be per-connection: syncPinterestBoards was
-- still writing every synced board into one shared per-user pool with
-- no record of origin, so an agency account running two Pinterest
-- connections (their own + a client's) would have both connections'
-- boards mixed into one indistinguishable list.
--
-- ON DELETE SET NULL (not CASCADE) -- disconnecting a Pinterest
-- connection shouldn't delete boards that were synced from it; they
-- just lose their origin tag (same reasoning as sites.
-- pinterest_connection_id / google_connection_id).
ALTER TABLE public.boards
  ADD COLUMN pinterest_connection_id uuid REFERENCES public.pinterest_connections(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
