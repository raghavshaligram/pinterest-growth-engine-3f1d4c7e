-- Per-site opt-in for appending hashtags to the published pin
-- description. Defaulted OFF: hashtags have always been generated and
-- stored on pin_briefs.hashtags (see the 20260715124417 initial
-- schema), but publisher.server.ts never merged them into the text sent
-- to Pinterest's pin create call -- they were only ever shown in the
-- pin detail dialog's own "Hashtags" field, never actually published.
-- That's being fixed as an opt-in (not on-by-default) since silently
-- changing the text of every future published pin for every existing
-- site would be a surprising behavior change, not a bug fix, for
-- accounts that never asked for hashtags in their descriptions.
ALTER TABLE public.sites
  ADD COLUMN pinterest_hashtags_enabled boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
