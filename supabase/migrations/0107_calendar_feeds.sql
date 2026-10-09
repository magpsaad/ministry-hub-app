-- 0107_calendar_feeds.sql -- SERVICE CALENDAR IN YOUR OWN CALENDAR
-- (owner-approved 9 Oct 2026). Each person can get a private link that
-- Google / Apple / Outlook Calendar subscribe to: the ministry's Service
-- Calendar shows up in their own calendar and stays updated. One way only
-- -- nothing comes back from their calendar.
--
-- * The link carries a long random code (calendar_feeds.token), one per
--   person per ministry. They can make a new one (the old one stops working
--   at once) or turn it off.
-- * It stops working by itself when the person is deactivated or no longer
--   has a role in the ministry.
-- * The feed is kept minimal: title, type, dates, times and place -- never
--   the description or attachments.
-- * Only this app's server can read a feed (the check-in server key, like
--   the other no-sign-in calls); it records when each link was last used.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0107_calendar_feeds.sql; commit;
-- Undo with 0107_down_calendar_feeds.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists calendar_feeds (
  ministry_id text not null references ministries(id),
  user_id uuid not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count integer not null default 0,
  primary key (ministry_id, user_id)
);
alter table calendar_feeds enable row level security;
revoke all on calendar_feeds from anon, authenticated;
grant all on calendar_feeds to service_role;

-- Mine: the code of my link here, or null if I haven't made one.
create or replace function my_calendar_feed()
returns text language sql stable security definer as $$
  select f.token from calendar_feeds f where f.ministry_id = current_ministry_id() and f.user_id = auth.uid()
$$;

-- Make my link, or a new one (the old one stops working).
create or replace function new_calendar_feed()
returns text language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false)
     or not exists (select 1 from user_roles ur where ur.ministry_id = v_m and ur.user_id = v_uid)
     or exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid and p.deactivated_at is not null) then
    raise exception 'Please sign in again';
  end if;
  insert into calendar_feeds (ministry_id, user_id, token) values (v_m, v_uid, v_token)
  on conflict (ministry_id, user_id) do update
    set token = excluded.token, created_at = now(), last_used_at = null, use_count = 0;
  return v_token;
end
$$;

-- Turn my link off.
create or replace function delete_calendar_feed()
returns void language sql security definer as $$
  delete from calendar_feeds where ministry_id = current_ministry_id() and user_id = auth.uid()
$$;

-- The feed itself, for this app's server only. Null when the link isn't
-- valid (unknown, turned off, or the person no longer serves here).
create or replace function calendar_feed(p_token text)
returns jsonb language plpgsql security definer as $$
declare f calendar_feeds; s app_settings;
begin
  perform app_server_check();
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into f from calendar_feeds where token = p_token;
  if f.token is null
     or not exists (select 1 from user_roles ur where ur.ministry_id = f.ministry_id and ur.user_id = f.user_id)
     or exists (select 1 from profiles p where p.ministry_id = f.ministry_id and p.id = f.user_id and p.deactivated_at is not null)
     or not exists (select 1 from ministries m where m.id = f.ministry_id and m.is_active) then
    return null;
  end if;
  update calendar_feeds set last_used_at = now(), use_count = use_count + 1 where token = p_token;
  select * into s from app_settings where ministry_id = f.ministry_id;
  return jsonb_build_object(
    'ministry_id', f.ministry_id,
    'title', s.app_title_short,
    'timezone', coalesce(s.timezone, 'America/Toronto'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'type', e.event_type::text,
               'start_date', e.start_date, 'end_date', e.end_date, 'all_day', e.all_day,
               'start_time', e.start_time, 'end_time', e.end_time, 'location', e.location,
               'updated', e.created_at)
             order by e.start_date)
      from service_calendar_events e
      where e.ministry_id = f.ministry_id
        and e.end_date >= (now() at time zone coalesce(s.timezone, 'America/Toronto'))::date - 400), '[]'::jsonb)
  );
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['my_calendar_feed()', 'new_calendar_feed()', 'delete_calendar_feed()', 'calendar_feed(text)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['my_calendar_feed()', 'new_calendar_feed()', 'delete_calendar_feed()'] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'grant execute on function calendar_feed(text) to anon, authenticated, service_role';
end
$$;
