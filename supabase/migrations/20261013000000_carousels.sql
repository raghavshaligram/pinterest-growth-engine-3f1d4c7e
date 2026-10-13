-- Instagram carousel lane: one listicle carousel a day built from a blog post.
-- Text is set by code (edge function render-carousel), photos come from the image provider (Nano Banana 2).
create table if not exists public.carousel_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  site_id uuid references public.sites(id) on delete set null,
  page_id uuid references public.pages(id) on delete set null,
  page_url text,
  site_url text,
  title text not null,
  design text not null default 'openai',  -- 'openai': the image model draws the whole slide, text included; 'code': photo plus text set by code
  caption text,
  hashtags text,
  -- drafting -> photos -> rendering -> review -> approved -> published (or failed / rejected)
  status text not null default 'photos',
  scheduled_for date,
  published_at timestamptz,
  error text,
  publish_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists carousel_posts_user_status_idx on public.carousel_posts(user_id, status);
create index if not exists carousel_posts_page_idx on public.carousel_posts(page_id);

create table if not exists public.carousel_slides (
  id uuid primary key default gen_random_uuid(),
  carousel_id uuid not null references public.carousel_posts(id) on delete cascade,
  user_id uuid not null,
  position int not null,
  kind text not null check (kind in ('cover','item','outro')),
  number int,
  heading text not null,
  body text,
  photo_prompt text,
  photo_path text,
  image_path text,
  alt_text text,
  error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (carousel_id, position)
);
create index if not exists carousel_slides_carousel_idx on public.carousel_slides(carousel_id);

alter table public.carousel_posts enable row level security;
alter table public.carousel_slides enable row level security;
create policy "carousel_posts owner" on public.carousel_posts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "carousel_slides owner" on public.carousel_slides for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.carousel_posts, public.carousel_slides to authenticated;
grant all on public.carousel_posts, public.carousel_slides to service_role;

-- Settings live in autopilot_settings (service role only). Defaults: 1 a day, review before publishing, not paused.
insert into public.autopilot_settings (key, value) values
  ('carousels_per_day', '1'),
  ('carousel_auto_approve', 'false'),
  ('carousels_paused', 'false'),
  ('carousel_design', 'openai'),
  ('carousel_image_quality', 'high')
on conflict (key) do nothing;

-- Schedules (UTC). brief 03:20, build every 2 min, publish hourly 12:05-15:05 (17:35-20:35 IST).
select cron.schedule('carousel-brief',   '20 3 * * *',   $$select public.autopilot_call('/api/public/cron/carousels?stage=brief')$$);
select cron.schedule('carousel-build',   '*/2 * * * *', $$select public.autopilot_call('/api/public/cron/carousels?stage=build')$$);
select cron.schedule('carousel-publish', '5 12-15 * * *', $$select public.autopilot_call('/api/public/cron/carousels?stage=publish')$$);

notify pgrst, 'reload schema';
