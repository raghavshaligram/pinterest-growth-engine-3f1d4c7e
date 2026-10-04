-- Several pins a day: the plan gets a slot per day, and the number of pins per day becomes a setting.
alter table public.autopilot_plan add column if not exists slot int not null default 0;
alter table public.autopilot_plan drop constraint if exists autopilot_plan_user_id_plan_date_key;
alter table public.autopilot_plan add constraint autopilot_plan_user_date_slot_key unique (user_id, plan_date, slot);

-- Change this number any time (1 to 12). The nightly plan step also sets the account's daily cap to match.
insert into public.autopilot_settings (key, value) values ('pins_per_day', '5')
  on conflict (key) do nothing;

-- Pin copy is written 3 days ahead: run that step more often and two pins at a time so a full day's pins are ready.
do $$
begin
  perform cron.unschedule('autopilot-briefs');
exception when others then null;
end $$;
select cron.schedule('autopilot-briefs', '*/10 2-10 * * *',
  $$select public.autopilot_call('/api/public/cron/autopilot?stage=briefs&limit=2')$$);

-- Rebuild the plan with the new slots.
delete from public.autopilot_plan where brief_id is null;
notify pgrst, 'reload schema';
