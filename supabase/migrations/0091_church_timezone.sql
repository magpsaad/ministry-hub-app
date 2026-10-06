-- 0091_church_timezone.sql -- THE CONSOLE HAS ITS OWN TIMEZONE SETTING
-- (owner-reported 5 Oct 2026: at 8:22 PM in Toronto the console's Release
-- Notes date already said tomorrow -- the console, belonging to no
-- ministry, worked in UTC. Owner's choice: the console gets its own setting,
-- not one borrowed from a ministry). Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0091_church_timezone.sql; commit;
-- Undo with 0091_down_church_timezone.sql.
--
-- * console_settings: one row, the console's own settings -- for now its
--   timezone (Console -> Settings), starting at America/Toronto. Readable by
--   anyone (it's shown on every console page); changed only by the Church
--   Admin, through set_console_timezone(), which accepts only a real
--   timezone name.
-- * church_timezone(): that timezone, for every address that belongs to no
--   ministry (the console's). app_releases.released_on defaults to today in
--   it (the app always sends a date; this is the backstop).
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists console_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/Toronto',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into console_settings (id) values (true) on conflict (id) do nothing;
alter table console_settings enable row level security;
drop policy if exists console_settings_select on console_settings;
create policy console_settings_select on console_settings for select to anon, authenticated using (true);
revoke all on console_settings from anon, authenticated;
grant select on console_settings to anon, authenticated;
grant all on console_settings to service_role;

create or replace function church_timezone()
returns text language sql stable security definer as $$
  select coalesce((select nullif(btrim(c.timezone), '') from console_settings c where c.id), 'UTC');
$$;

create or replace function set_console_timezone(p_timezone text)
returns void language plpgsql security definer as $$
declare v_tz text := btrim(coalesce(p_timezone, ''));
begin
  if not is_church_admin() then
    raise exception 'Only the Church Admin can change the console''s timezone';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception '"%" isn''t a recognized timezone name (for example America/Toronto)', v_tz;
  end if;
  update console_settings set timezone = v_tz, updated_at = now(), updated_by = auth.uid() where id;
end
$$;

do $$
begin
  execute format('alter function church_timezone() set search_path = %I, public, pg_temp', current_schema());
  execute format('alter function set_console_timezone(text) set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function church_timezone() from public';
  execute 'grant execute on function church_timezone() to anon, authenticated, service_role';
  execute 'revoke all on function set_console_timezone(text) from public, anon';
  execute 'grant execute on function set_console_timezone(text) to authenticated, service_role';
end
$$;

alter table app_releases alter column released_on set default ((now() at time zone church_timezone())::date);
