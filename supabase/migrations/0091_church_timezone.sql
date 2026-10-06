-- 0091_church_timezone.sql -- THE CONSOLE'S TIMEZONE COMES FROM THE MINISTRIES'
-- SETTINGS (owner-reported 5 Oct 2026: at 8:22 PM in Toronto the console's
-- Release Notes date already said tomorrow -- the console, belonging to no
-- ministry, worked in UTC). Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0091_church_timezone.sql; commit;
-- Undo with 0091_down_church_timezone.sql.
--
-- * church_timezone(): the timezone the church's active ministries use
--   (Ministry Settings -> Timezone; the most common one if they differ),
--   UTC only if there are none. Read by the console and by any address that
--   isn't a ministry's. Holds nothing private (it's shown on every page).
-- * app_releases.released_on defaults to today in that timezone (the app
--   always sends a date; this is the backstop).
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function church_timezone()
returns text language sql stable security definer as $$
  select coalesce((
    select a.timezone
    from app_settings a join ministries m on m.id = a.ministry_id
    where m.is_active and nullif(btrim(a.timezone), '') is not null
    group by a.timezone
    order by count(*) desc, a.timezone
    limit 1
  ), 'UTC');
$$;

do $$
begin
  execute format('alter function church_timezone() set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function church_timezone() from public';
  execute 'grant execute on function church_timezone() to anon, authenticated, service_role';
end
$$;

alter table app_releases alter column released_on set default ((now() at time zone church_timezone())::date);
