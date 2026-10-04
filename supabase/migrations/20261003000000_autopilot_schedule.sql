-- Autopilot: a daily schedule that runs the whole pin pipeline with nobody at the keyboard.
--
--   crawl -> analyze -> plan (30-day calendar) -> briefs (ONE pin per day) -> images -> materialize (slots) -> queue -> publish (webhook -> Make)
--
-- Each stage is a POST to the app's own cron endpoint (/api/public/cron/*, authenticated with the project's
-- publishable key in an `apikey` header, same as before). pg_cron fires them, pg_net makes the HTTP calls.
--
-- ONE-TIME SETUP after this migration runs (SQL editor, values are not committed to git):
--   insert into public.autopilot_settings (key, value) values
--     ('base_url', 'https://YOUR-PUBLISHED-PINSPIDER-URL'),      -- no trailing slash
--     ('apikey',   'YOUR SUPABASE PUBLISHABLE KEY (the SUPABASE_PUBLISHABLE_KEY value)');
-- To pause everything: select cron.unschedule(jobname) from cron.job where jobname like 'autopilot-%';
-- Times are UTC. The plan stage keeps 30 days of one-pin-per-day calendar; the pin is published between 19:00 and 23:00 UTC.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The content calendar: one row per day = the page and the pin theme/format for that day.
create table if not exists public.autopilot_plan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_date date not null,
  page_id uuid not null references public.pages(id) on delete cascade,
  template_id text,
  theme_id text,
  brief_id uuid references public.pin_briefs(id) on delete set null,
  status text not null default 'planned',   -- planned | briefed | error
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, plan_date)
);
alter table public.autopilot_plan enable row level security;
drop policy if exists "own plan" on public.autopilot_plan;
create policy "own plan" on public.autopilot_plan for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One pin a day: pin the account's daily cap at 1 (manual mode so the weekly auto-adjust does not raise it).
update public.account_publishing_profiles set cap_mode = 'manual', manual_cap = 1, current_daily_cap = 1;

create table if not exists public.autopilot_settings (
  key text primary key,
  value text not null
);
alter table public.autopilot_settings enable row level security;  -- no policies: only the service role / postgres can read it

create or replace function public.autopilot_call(p_path text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_key text;
begin
  select value into v_url from public.autopilot_settings where key = 'base_url';
  select value into v_key from public.autopilot_settings where key = 'apikey';
  if v_url is null or v_key is null then
    raise notice 'autopilot: base_url / apikey not set in autopilot_settings, skipping %', p_path;
    return;
  end if;
  perform net.http_post(
    url := v_url || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.autopilot_call(text) from public, anon, authenticated;

-- Re-running this migration replaces the jobs instead of duplicating them.
do $$
declare j text;
begin
  for j in select jobname from cron.job where jobname like 'autopilot-%' loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule('autopilot-crawl',       '30 0,12 * * *',     $$select public.autopilot_call('/api/public/cron/crawl')$$);
select cron.schedule('autopilot-analyze',     '0,30 1-4 * * *', $$select public.autopilot_call('/api/public/cron/autopilot?stage=analyze&limit=3')$$);
select cron.schedule('autopilot-plan',        '50 4 * * *',     $$select public.autopilot_call('/api/public/cron/autopilot?stage=plan')$$);
select cron.schedule('autopilot-briefs',      '15 2-10 * * *',  $$select public.autopilot_call('/api/public/cron/autopilot?stage=briefs&limit=1')$$);
select cron.schedule('autopilot-images',      '*/10 * * * *',   $$select public.autopilot_call('/api/public/cron/images')$$);
select cron.schedule('autopilot-materialize', '30 11 * * *',    $$select public.autopilot_call('/api/public/cron/materialize')$$);
select cron.schedule('autopilot-queue',       '45 11 * * *',    $$select public.autopilot_call('/api/public/cron/autopilot?stage=queue')$$);
select cron.schedule('autopilot-publish',     '*/15 * * * *',   $$select public.autopilot_call('/api/public/cron/publish')$$);

notify pgrst, 'reload schema';
