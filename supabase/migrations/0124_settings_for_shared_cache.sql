-- 0124_settings_for_shared_cache.sql -- MINISTRY SETTINGS KEPT IN ONE SHARED
-- COPY (owner-approved 17 Oct 2026). The app now keeps each ministry's
-- settings in a shared cache (refreshed whenever they're saved in the app,
-- and at least once a day), read without anyone's sign-in. app_settings,
-- universities and app_releases can already be read that way; these two
-- give the same session-less read of the two other ministry-wide lists --
-- setting values only, nobody's personal information:
-- * ministry_actions_needed_config(): the Actions Needed thresholds.
-- * ministry_active_verses(): the active verses shown on the banner.
-- Both answer for the ministry of the address the request came in on.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0124_settings_for_shared_cache.sql; commit;
-- Undo with 0124_down_settings_for_shared_cache.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function ministry_actions_needed_config()
returns jsonb
language sql stable security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'proximity', c.proximity, 'min_presence_count', c.min_presence_count,
           'min_absence_weeks', c.min_absence_weeks, 'min_outreach_weeks', c.min_outreach_weeks)
         order by c.proximity), '[]'::jsonb)
  from actions_needed_config c
  where c.ministry_id = current_ministry_id();
$$;

create or replace function ministry_active_verses()
returns jsonb
language sql stable security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('text', v.text, 'reference', v.reference)), '[]'::jsonb)
  from verses v
  where v.ministry_id = current_ministry_id() and v.is_active;
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function ministry_actions_needed_config() set search_path = %I, public, pg_temp', s);
  execute format('alter function ministry_active_verses() set search_path = %I, public, pg_temp', s);
  revoke all on function ministry_actions_needed_config() from public;
  revoke all on function ministry_active_verses() from public;
  grant execute on function ministry_actions_needed_config() to anon, authenticated;
  grant execute on function ministry_active_verses() to anon, authenticated;
end
$$;
