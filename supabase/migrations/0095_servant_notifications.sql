-- 0095_servant_notifications.sql -- FIVE NOTIFICATIONS FOR SERVANTS
-- (owner-requested 6 Oct 2026). Each goes only to the servant concerned,
-- opens the Dashboard, and respects My Settings:
--   outreach_needed  one of my youths became "outreach needed" (a yellow
--                    card) -- once per yellow card; default OFF
--   newly_assigned   a coordinator assigned a youth to me; default OFF
--   follow_up_due    a follow-up reminder I set is due today; default ON
--   birthday         one of my youths' birthday is today; default ON
--   weekly_recap     my yellow / blue / purple / green card counts, on the
--                    day and hour I choose (Saturday 9 AM unless changed);
--                    skipped when all four are zero; default ON
-- Owner's decisions: night is 9 PM - 9 AM in the ministry's timezone --
-- nothing above goes out then except the weekly recap at the hour the
-- servant picked (offered 9 AM - 8 PM only); several of the same kind on
-- one run are combined into one notification; yellow cards that already
-- exist at launch count (no baseline).
--
-- How: pg_cron runs notify_tick() every 5 minutes; it queues what's due
-- in notification_outbox and then asks the app (pg_net -> /api/push/tick)
-- to send. The yellow-card rule is notification_yellow(), a copy of
-- web/src/lib/actions-needed.ts computeActionsNeeded() -- KEEP THE TWO IN
-- STEP; birthdays copy lib/dashboard.ts birthdaysInWindow(), follow-ups
-- copy lib/outreach.ts getFollowUpsDue(), blue cards
-- getNewlyAssignedMembers(). Dashboard groups = not archived, not the
-- hidden terminal (hand-over) groups.
-- Needs pg_cron and pg_net (enabled once for the whole database).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0095_servant_notifications.sql; commit;
-- Undo with 0095_down_servant_notifications.sql.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- Catalog entries (My Settings -> Notifications)
-- ---------------------------------------------------------------------
insert into notification_events (event, label, description, roles, default_on, sort_order) values
  ('outreach_needed', 'Outreach needed',
   'When one of your assigned youths needs outreach (a yellow card on the Dashboard).',
   '{admin,general_coordinator,sub_coordinator,servant}', false, 30),
  ('newly_assigned', 'Newly assigned youth',
   'When a coordinator assigns a youth to you.',
   '{admin,general_coordinator,sub_coordinator,servant}', false, 40),
  ('follow_up_due', 'Follow-up reminders',
   'On the day a follow-up reminder you set comes due.',
   '{admin,general_coordinator,sub_coordinator,servant}', true, 50),
  ('birthday', 'Birthdays',
   'On the birthday of each youth assigned to you.',
   '{admin,general_coordinator,sub_coordinator,servant}', true, 60),
  ('weekly_recap', 'Weekly recap',
   'How many of your youths need outreach, are newly assigned, have follow-ups due or birthdays coming up.',
   '{admin,general_coordinator,sub_coordinator,servant}', true, 70)
on conflict (event) do update
  set label = excluded.label, description = excluded.description, roles = excluded.roles,
      default_on = excluded.default_on, sort_order = excluded.sort_order;

-- The weekly recap's day (0 = Sunday ... 6 = Saturday) and hour, per person.
alter table notification_preferences add column if not exists weekly_day smallint;
alter table notification_preferences add column if not exists weekly_hour smallint;
alter table notification_preferences drop constraint if exists notification_preferences_weekly_check;
alter table notification_preferences add constraint notification_preferences_weekly_check
  check ((weekly_day is null or weekly_day between 0 and 6) and (weekly_hour is null or weekly_hour between 9 and 20));

-- ---------------------------------------------------------------------
-- State: what was already sent, assignments waiting to be combined, and
-- where this environment's app is.
-- ---------------------------------------------------------------------
create table if not exists notification_marks (
  event text not null references notification_events(event) on delete cascade,
  target_user_id uuid not null,
  mark_key text not null,
  ministry_id text not null references ministries(id),
  created_at timestamptz not null default now(),
  primary key (event, target_user_id, mark_key)
);
alter table notification_marks enable row level security;
revoke all on notification_marks from anon, authenticated;
grant all on notification_marks to service_role;

create table if not exists notification_staged (
  id bigint generated always as identity primary key,
  ministry_id text not null references ministries(id),
  event text not null references notification_events(event) on delete cascade,
  target_user_id uuid not null,
  member_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists notification_staged_target_idx on notification_staged (ministry_id, event, target_user_id);
alter table notification_staged enable row level security;
revoke all on notification_staged from anon, authenticated;
grant all on notification_staged to service_role;

create table if not exists notification_dispatch (
  id integer primary key check (id = 1),
  url text not null check (url like 'https://%/api/push/tick')
);
alter table notification_dispatch enable row level security;
revoke all on notification_dispatch from anon, authenticated;
grant all on notification_dispatch to service_role;
insert into notification_dispatch (id, url)
values (1, case current_schema()
             when 'prod' then 'https://youth-ministry-app-prod.vercel.app/api/push/tick'
             else 'https://youth-ministry-app-qa.vercel.app/api/push/tick' end)
on conflict (id) do update set url = excluded.url;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- Would this person get this kind here? A device on, a role it's listed
-- for, not deactivated, and switched on (or on by default).
create or replace function notify_wants(p_ministry text, p_user uuid, p_event text)
returns boolean language sql stable security definer as $$
  select exists (select 1 from push_subscriptions s where s.ministry_id = p_ministry and s.user_id = p_user)
     and exists (select 1 from notification_events ne
                 join user_roles ur on ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role::text = any(ne.roles)
                 where ne.event = p_event)
     and not exists (select 1 from profiles p where p.ministry_id = p_ministry and p.id = p_user and p.deactivated_at is not null)
     and coalesce((select np.enabled from notification_preferences np
                   where np.user_id = p_user and np.ministry_id = p_ministry and np.event = p_event),
                  (select ne.default_on from notification_events ne where ne.event = p_event), false)
$$;

-- "Mina S.", "Mina S. and John D.", "Mina S., John D. and Mary A.",
-- "Mina S., John D., Mary A. and 2 more".
create or replace function notify_names(p_names text[])
returns text language plpgsql immutable as $$
declare n int := coalesce(array_length(p_names, 1), 0);
begin
  if n = 0 then return ''; end if;
  if n = 1 then return p_names[1]; end if;
  if n = 2 then return p_names[1] || ' and ' || p_names[2]; end if;
  if n = 3 then return p_names[1] || ', ' || p_names[2] || ' and ' || p_names[3]; end if;
  return p_names[1] || ', ' || p_names[2] || ', ' || p_names[3] || ' and ' || (n - 3) || ' more';
end
$$;

create or replace function notify_short(p_full text)
returns text language sql immutable as $$
  select coalesce(nullif(checkin_short_name(nullif(btrim(p_full), ''), false), ''), 'A youth')
$$;

-- The day this year's birthday falls on, as the Dashboard counts it
-- (Feb 29 in a non-leap year = Mar 1).
create or replace function notify_bday_this_year(p_dob date, p_year int)
returns date language sql immutable as $$
  select (make_date(p_year, 1, 1)
          + make_interval(months => extract(month from p_dob)::int - 1)
          + make_interval(days => extract(day from p_dob)::int - 1))::date
$$;

-- The Dashboard's "Actions Needed" yellow cards for one ministry -- a copy
-- of computeActionsNeeded() (web/src/lib/actions-needed.ts).
create or replace function notification_yellow(p_ministry text)
returns table (member_id uuid, assigned_servant_id uuid, full_name text, episode text)
language sql stable security definer as $$
  with s as (
    select coalesce(timezone, 'America/Toronto') tz, proximity_enabled,
           coalesce(actions_needed_lookback_months, 12) lookback
    from app_settings where ministry_id = p_ministry
  ), d as (
    select (now() at time zone s.tz)::date today, s.* from s
  ), cut as (
    -- shiftDateKey(today, { months: -lookback }): JS month arithmetic,
    -- where the 31st of a short month rolls into the next.
    select (date_trunc('month', today)::date
            + make_interval(months => -lookback)
            + make_interval(days => extract(day from today)::int - 1))::date cutoff, d.* from d
  ), m as (
    select mem.id, mem.assigned_servant_id, mem.full_name, mem.created_at,
           case when cut.proximity_enabled then coalesce(u.proximity::text, 'Unknown') else 'Local' end proximity,
           cut.cutoff
    from members mem
    join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
    left join universities u on u.id = mem.university_id
    cross join cut
    where mem.ministry_id = p_ministry and mem.status::text = 'active' and not coalesce(mem.is_visitor, false)
  ), a as (
    select m.*,
           (select count(distinct ar.service_date) from attendance_records ar
             where ar.attendee_type::text = 'member' and ar.member_id = m.id and ar.service_date >= m.cutoff) presence,
           coalesce((select max(ar.service_date) from attendance_records ar
                      where ar.attendee_type::text = 'member' and ar.member_id = m.id),
                    (m.created_at at time zone 'UTC')::date) ref_date,
           (select max(oe.occurred_at) from outreach_entries oe where oe.member_id = m.id) last_outreach
    from m
  )
  select a.id, a.assigned_servant_id, a.full_name,
         a.id::text || ':' || coalesce(a.ref_date::text, '') || ':' || coalesce(a.last_outreach::text, 'none')
  from a
  join actions_needed_config c on c.ministry_id = p_ministry and c.proximity::text = a.proximity
  where a.presence >= c.min_presence_count
    and (case when a.ref_date is null then 0
              else floor(extract(epoch from (now() - (a.ref_date::timestamp at time zone 'UTC'))) / 604800) end) >= c.min_absence_weeks
    and (a.last_outreach is null or now() - a.last_outreach > make_interval(days => 7 * c.min_outreach_weeks))
$$;

create or replace function notify_person(p_ministry text, p_event text, p_user uuid, p_title text, p_body text)
returns void language sql security definer as $$
  insert into notification_outbox (ministry_id, event, audience, target_user_id, title, body, url)
  values (p_ministry, p_event, 'person', p_user, p_title, left(p_body, 500), '/')
$$;

-- ---------------------------------------------------------------------
-- Newly assigned: staged when a coordinator assigns, combined by the tick
-- once no more assignments for that servant arrived for 2 minutes.
-- ---------------------------------------------------------------------
create or replace function stage_newly_assigned()
returns trigger language plpgsql security definer as $$
begin
  if new.assigned_servant_id is not null
     and new.assigned_servant_id is distinct from old.assigned_servant_id
     and new.is_new_assignment and new.status::text = 'active'
     and exists (select 1 from push_subscriptions s
                 where s.user_id = new.assigned_servant_id and s.ministry_id = new.ministry_id) then
    insert into notification_staged (ministry_id, event, target_user_id, member_id)
    values (new.ministry_id, 'newly_assigned', new.assigned_servant_id, new.id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_stage_newly_assigned on members;
create trigger trg_stage_newly_assigned after update of assigned_servant_id on members
  for each row execute function stage_newly_assigned();

-- ---------------------------------------------------------------------
-- The tick (pg_cron, every 5 minutes)
-- ---------------------------------------------------------------------
create or replace function notify_tick()
returns integer language plpgsql security definer as $$
declare
  r record; rec record;
  v_local timestamp; v_today date; v_daytime boolean;
  v_queued int := 0;
  v_names text[]; v_keys text[];
  v_day int; v_hour int; v_y int; v_b int; v_p int; v_g int; v_parts text[];
  v_before int; v_after int; v_label text;
  v_url text;
begin
  for r in
    select m.id, coalesce(s.timezone, 'America/Toronto') tz,
           coalesce(s.birthday_window_days_before, 7) before_days,
           coalesce(s.birthday_window_days_after, 14) after_days
    from ministries m join app_settings s on s.ministry_id = m.id
    where m.is_active
  loop
    v_local := now() at time zone r.tz;
    v_today := v_local::date;
    v_daytime := v_local::time >= time '09:00' and v_local::time < time '21:00';

    if v_daytime then
      -- 1. Outreach needed: every yellow card once, per servant combined.
      if exists (select 1 from push_subscriptions ps
                 where ps.ministry_id = r.id and notify_wants(r.id, ps.user_id, 'outreach_needed')) then
        for rec in
          select y.assigned_servant_id uid,
                 array_agg(notify_short(y.full_name) order by y.full_name) names,
                 array_agg(y.episode) keys
          from notification_yellow(r.id) y
          where y.assigned_servant_id is not null
            and not exists (select 1 from notification_marks k
                            where k.event = 'outreach_needed' and k.target_user_id = y.assigned_servant_id
                              and k.mark_key = y.episode)
            and notify_wants(r.id, y.assigned_servant_id, 'outreach_needed')
          group by y.assigned_servant_id
        loop
          insert into notification_marks (event, target_user_id, mark_key, ministry_id)
          select 'outreach_needed', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
          perform notify_person(r.id, 'outreach_needed', rec.uid, 'Outreach needed',
            notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' hasn''t' else ' haven''t' end
            || ' been at service in a while. Please reach out.');
          v_queued := v_queued + 1;
        end loop;
      end if;

      -- 2. Newly assigned, once that servant's assignments have settled.
      for rec in
        select st.target_user_id uid from notification_staged st
        where st.ministry_id = r.id and st.event = 'newly_assigned'
        group by st.target_user_id
        having max(st.created_at) < now() - interval '2 minutes'
      loop
        select array_agg(notify_short(x.full_name) order by x.full_name) into v_names
        from (select distinct mem.id, mem.full_name
              from notification_staged st
              join members mem on mem.id = st.member_id
              join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
              where st.ministry_id = r.id and st.event = 'newly_assigned' and st.target_user_id = rec.uid
                and mem.assigned_servant_id = rec.uid and mem.is_new_assignment and mem.status::text = 'active') x;
        if v_names is not null and notify_wants(r.id, rec.uid, 'newly_assigned') then
          perform notify_person(r.id, 'newly_assigned', rec.uid, 'Newly assigned to you',
            notify_names(v_names) || case when array_length(v_names, 1) = 1 then ' is' else ' are' end
            || ' now assigned to you. Say hello!');
          v_queued := v_queued + 1;
        end if;
        delete from notification_staged
        where ministry_id = r.id and event = 'newly_assigned' and target_user_id = rec.uid;
      end loop;

      -- 3. Follow-up reminders due today, to the servant who set them.
      for rec in
        select oe.servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(oe.id::text) keys
        from outreach_entries oe
        join members mem on mem.id = oe.member_id
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where oe.ministry_id = r.id and oe.follow_up_due = v_today and oe.follow_up_dismissed_at is null
          and oe.servant_id is not null
          and not exists (select 1 from notification_marks k
                          where k.event = 'follow_up_due' and k.target_user_id = oe.servant_id and k.mark_key = oe.id::text)
          and notify_wants(r.id, oe.servant_id, 'follow_up_due')
        group by oe.servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'follow_up_due', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'follow_up_due', rec.uid, 'Follow-up due today',
          'Your follow-up' || case when array_length(rec.names, 1) = 1 then '' else 's' end
          || ' with ' || notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' is' else ' are' end
          || ' due today.');
        v_queued := v_queued + 1;
      end loop;

      -- 4. Birthdays today, to the assigned servant.
      for rec in
        select mem.assigned_servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(mem.id::text || ':' || v_today::text) keys
        from members mem
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
          and mem.assigned_servant_id is not null
          and notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int) = v_today
          and not exists (select 1 from notification_marks k
                          where k.event = 'birthday' and k.target_user_id = mem.assigned_servant_id
                            and k.mark_key = mem.id::text || ':' || v_today::text)
          and notify_wants(r.id, mem.assigned_servant_id, 'birthday')
        group by mem.assigned_servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'birthday', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'birthday', rec.uid, 'Birthday today 🎂',
          case when array_length(rec.names, 1) = 1 then 'Today is ' || rec.names[1] || '''s birthday.'
               else 'Today is the birthday of ' || notify_names(rec.names) || '.' end);
        v_queued := v_queued + 1;
      end loop;
    end if;

    -- 5. Weekly recap, on each servant's own day and hour.
    for rec in
      select distinct ps.user_id uid from push_subscriptions ps
      where ps.ministry_id = r.id
        and not exists (select 1 from notification_marks k
                        where k.event = 'weekly_recap' and k.target_user_id = ps.user_id
                          and k.mark_key = 'week:' || v_today::text)
        and notify_wants(r.id, ps.user_id, 'weekly_recap')
    loop
      select coalesce(np.weekly_day, 6), coalesce(np.weekly_hour, 9) into v_day, v_hour
      from (select 1) one
      left join notification_preferences np
        on np.user_id = rec.uid and np.ministry_id = r.id and np.event = 'weekly_recap';
      if extract(dow from v_local)::int = v_day and extract(hour from v_local)::int >= v_hour then
        select count(*) into v_y from notification_yellow(r.id) y where y.assigned_servant_id = rec.uid;
        select count(*) into v_b from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.is_new_assignment
            and mem.assigned_servant_id = rec.uid;
        select count(*) into v_p from outreach_entries oe
          join members mem on mem.id = oe.member_id
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where oe.ministry_id = r.id and oe.servant_id = rec.uid and oe.follow_up_due is not null
            and oe.follow_up_dismissed_at is null and oe.follow_up_due <= v_today;
        select count(*) into v_g from (
          select (notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int)
                  - make_date(extract(year from v_today)::int, 1, 1))
                 - (v_today - make_date(extract(year from v_today)::int, 1, 1)) diff
          from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
            and mem.assigned_servant_id = rec.uid
        ) b
        where (case when b.diff < -r.before_days then b.diff + 365
                    when b.diff > r.after_days then b.diff - 365 else b.diff end) between -r.before_days and r.after_days;

        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        values ('weekly_recap', rec.uid, 'week:' || v_today::text, r.id) on conflict do nothing;
        if v_y + v_b + v_p + v_g > 0 then
          v_parts := array[]::text[];
          if v_y > 0 then v_parts := v_parts || (v_y || ' need' || case when v_y = 1 then 's' else '' end || ' outreach'); end if;
          if v_b > 0 then v_parts := v_parts || (v_b || ' newly assigned'); end if;
          if v_p > 0 then v_parts := v_parts || (v_p || ' follow-up' || case when v_p = 1 then '' else 's' end || ' due'); end if;
          if v_g > 0 then v_parts := v_parts || (v_g || ' birthday' || case when v_g = 1 then '' else 's' end); end if;
          perform notify_person(r.id, 'weekly_recap', rec.uid, 'Your weekly recap',
            array_to_string(v_parts, ' · ') || '. Tap to see them on your Dashboard.');
          v_queued := v_queued + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- Housekeeping.
  delete from notification_marks where created_at < now() - interval '400 days';
  delete from notification_staged where created_at < now() - interval '3 days';

  -- Ask this environment's app to send what was queued.
  if v_queued > 0 then
    begin
      select url into v_url from notification_dispatch where id = 1;
      if v_url is not null then
        perform net.http_post(url := v_url, body := '{}'::jsonb,
                              headers := '{"Content-Type": "application/json"}'::jsonb);
      end if;
    exception when others then
      null; -- the next visit to the app sends them anyway (0092 catch-up)
    end;
  end if;
  return v_queued;
end
$$;

-- ---------------------------------------------------------------------
-- My Settings: the weekly recap's day and hour.
-- ---------------------------------------------------------------------
drop function if exists my_notification_settings();
create function my_notification_settings()
returns table (event text, label text, description text, enabled boolean, weekly_day smallint, weekly_hour smallint)
language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then
    raise exception 'Please sign in again';
  end if;
  return query
  select ne.event, ne.label, ne.description, coalesce(np.enabled, ne.default_on),
         case when ne.event = 'weekly_recap' then coalesce(np.weekly_day, 6::smallint) end,
         case when ne.event = 'weekly_recap' then coalesce(np.weekly_hour, 9::smallint) end
  from notification_events ne
  left join notification_preferences np
    on np.event = ne.event and np.user_id = v_uid and np.ministry_id = v_m
  where exists (select 1 from user_roles ur
                where ur.ministry_id = v_m and ur.user_id = v_uid and ur.role::text = any(ne.roles))
  order by ne.sort_order, ne.label;
end
$$;

create or replace function set_notification_schedule(p_event text, p_day smallint, p_hour smallint)
returns boolean language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then
    raise exception 'Please sign in again';
  end if;
  if p_event <> 'weekly_recap' or p_day is null or p_day not between 0 and 6
     or p_hour is null or p_hour not between 9 and 20
     or not exists (select 1 from notification_events ne
                    join user_roles ur on ur.ministry_id = v_m and ur.user_id = v_uid and ur.role::text = any(ne.roles)
                    where ne.event = p_event) then
    raise exception 'That schedule isn''t available.';
  end if;
  insert into notification_preferences (user_id, ministry_id, event, enabled, weekly_day, weekly_hour)
  values (v_uid, v_m, p_event, (select default_on from notification_events where event = p_event), p_day, p_hour)
  on conflict (user_id, ministry_id, event) do update
    set weekly_day = excluded.weekly_day, weekly_hour = excluded.weekly_hour, updated_at = now();
  return true;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array[
    'notify_wants(text, uuid, text)', 'notify_names(text[])', 'notify_short(text)',
    'notify_bday_this_year(date, integer)', 'notification_yellow(text)',
    'notify_person(text, text, uuid, text, text)', 'stage_newly_assigned()', 'notify_tick()',
    'my_notification_settings()', 'set_notification_schedule(text, smallint, smallint)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['my_notification_settings()', 'set_notification_schedule(text, smallint, smallint)'] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- Every 5 minutes, this environment's own job.
  perform cron.schedule('ministry-hub-notify-' || s, '*/5 * * * *', format('select %I.notify_tick()', s));
end
$$;
