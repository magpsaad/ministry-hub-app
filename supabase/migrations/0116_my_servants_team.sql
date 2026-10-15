-- 0116_my_servants_team.sql -- MY SERVANTS TEAM (owner-approved 15 Oct
-- 2026). Coordinators (and General Coordinators, over everyone) are shown
-- -- and told -- when the servants they look after have been absent a
-- while, have gone quiet in the app, or have a birthday.
--
-- * profiles.birthday_month / birthday_day: an optional birthday, day and
--   month only (no year). Each person can set their own; whoever can
--   already edit a servant's profile can set it too. birthday_ask_after:
--   when the Dashboard may ask them for it again ('infinity' = never).
-- * app_settings.servant_absence_weeks (default 3) and servant_quiet_days
--   (default 15): when a servant counts as absent a while / quiet.
-- * last_seen: when each person last opened the app (noted at most once a
--   day by note_seen()), seeded from what the app already knew.
-- * servant_team(): the people a Coordinator (their groups' Servants and
--   Coordinators) or a General Coordinator or System Admin (everyone) looks after, with
--   their absences, last-seen and birthday. my_servant_team() is the
--   signed-in person's own; servant_team_line() the weekly-recap line.
-- * dashboard_prefs: each person's choice of which Dashboard panels start
--   open or collapsed.
-- * Alerts: servants' birthdays go out with the Birthdays alert on the day
--   (notify_servant_birthdays); the Weekly recap gains a line about the
--   team. No new alert kinds.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0116_my_servants_team.sql; commit;
-- Undo with 0116_down_my_servants_team.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- 1. Birthdays (day and month only).
alter table profiles
  add column if not exists birthday_month smallint,
  add column if not exists birthday_day smallint,
  add column if not exists birthday_ask_after timestamptz;
alter table profiles drop constraint if exists profiles_birthday_valid;
alter table profiles add constraint profiles_birthday_valid check (
  (birthday_month is null and birthday_day is null)
  or (birthday_month between 1 and 12 and birthday_day between 1 and
      case when birthday_month = 2 then 29 when birthday_month in (4, 6, 9, 11) then 30 else 31 end)
);
grant update (birthday_month, birthday_day) on profiles to authenticated;

-- 2. Settings.
alter table app_settings
  add column if not exists servant_absence_weeks smallint not null default 3,
  add column if not exists servant_quiet_days smallint not null default 15;
alter table app_settings drop constraint if exists app_settings_servant_team_valid;
alter table app_settings add constraint app_settings_servant_team_valid check (
  servant_absence_weeks between 1 and 52 and servant_quiet_days between 1 and 365
);

-- 3. Last seen.
create table if not exists last_seen (
  ministry_id text not null references ministries(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (ministry_id, user_id)
);
alter table last_seen enable row level security;
revoke all on last_seen from anon, authenticated;
grant all on last_seen to service_role;

insert into last_seen (ministry_id, user_id, seen_at)
select x.ministry_id, x.user_id, max(x.at)
from (
  select a.ministry_id, a.user_id, a.occurred_at at from audit_log a where a.user_id is not null
  union all
  select l.ministry_id, l.user_id, l.last_at from link_opens l
  union all
  select h.ministry_id, h.user_id, h.last_at from home_icon_opens h
) x
join profiles p on p.id = x.user_id and p.ministry_id = x.ministry_id
group by x.ministry_id, x.user_id
on conflict (ministry_id, user_id) do update set seen_at = greatest(last_seen.seen_at, excluded.seen_at);

create or replace function note_seen()
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or v_m is null
     or not exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid) then
    return;
  end if;
  insert into last_seen (ministry_id, user_id) values (v_m, v_uid)
  on conflict (ministry_id, user_id) do update set seen_at = now();
end
$$;

-- 4. Dashboard panels: start open or collapsed, per person.
create table if not exists dashboard_prefs (
  ministry_id text not null references ministries(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  panel text not null check (panel in ('servant_team', 'birthdays', 'registrations', 'actions_needed')),
  start_open boolean not null,
  primary key (ministry_id, user_id, panel)
);
alter table dashboard_prefs enable row level security;
revoke all on dashboard_prefs from anon, authenticated;
grant all on dashboard_prefs to service_role;

create or replace function my_dashboard_prefs()
returns table (panel text, start_open boolean)
language sql stable security definer as $$
  select d.panel, d.start_open from dashboard_prefs d
  where d.ministry_id = current_ministry_id() and d.user_id = auth.uid()
$$;

create or replace function set_dashboard_pref(p_panel text, p_open boolean)
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or p_open is null
     or not exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid) then
    raise exception 'Please sign in again';
  end if;
  insert into dashboard_prefs (ministry_id, user_id, panel, start_open) values (v_m, v_uid, p_panel, p_open)
  on conflict (ministry_id, user_id, panel) do update set start_open = excluded.start_open;
end
$$;

-- "Not now" (p_days) or "No thanks" (null) on the Dashboard's birthday card.
create or replace function snooze_birthday_prompt(p_days integer)
returns void language sql security definer as $$
  update profiles
  set birthday_ask_after = case when p_days is null then 'infinity'::timestamptz
                                else now() + make_interval(days => least(greatest(p_days, 1), 365)) end
  where id = auth.uid() and ministry_id = current_ministry_id()
$$;

-- 5. The team.
create or replace function servant_team(p_ministry text, p_user uuid)
returns table (person_id uuid, full_name text, gender text, photo_path text, phone text,
               group_id uuid, group_name text, group_order integer,
               is_servant boolean, is_coordinator boolean,
               absent_weeks integer, present_last boolean, counted_last boolean, last_service date,
               last_seen_at timestamptz, quiet boolean,
               birthday_month smallint, birthday_day smallint, birthday_offset integer)
language plpgsql stable security definer as $$
#variable_conflict use_column
declare
  v_s app_settings%rowtype;
  v_today date; v_y integer; v_gc boolean; v_groups uuid[]; v_dates date[]; v_last date;
begin
  select * into v_s from app_settings s where s.ministry_id = p_ministry;
  if not found or p_user is null then
    return;
  end if;
  v_today := (now() at time zone coalesce(v_s.timezone, 'America/Toronto'))::date;
  v_y := extract(year from v_today)::int;
  v_gc := exists (select 1 from user_roles ur
                  where ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role::text in ('general_coordinator', 'admin'));
  if not v_gc then
    v_groups := my_coordinated_groups(p_ministry, p_user);
    if coalesce(cardinality(v_groups), 0) = 0 then
      return;
    end if;
  end if;

  -- The service days servant attendance was taken on, this past year.
  select array_agg(distinct ar.service_date order by ar.service_date) into v_dates
  from attendance_records ar
  where ar.ministry_id = p_ministry and ar.attendee_type::text = 'servant' and ar.event_id is null
    and ar.service_date <= v_today and ar.service_date > v_today - 366
    and extract(isodow from ar.service_date)::int = v_s.service_weekday
    and (v_s.using_app_since is null or ar.service_date >= v_s.using_app_since);
  v_dates := coalesce(v_dates, '{}'::date[]);
  v_last := v_dates[array_upper(v_dates, 1)];

  return query
  with g as (
    select ur.user_id uid, ur.group_id gid,
           bool_or(ur.role::text = 'servant') is_s, bool_or(ur.role::text = 'sub_coordinator') is_c
    from user_roles ur
    left join groups gr on gr.id = ur.group_id
    where ur.ministry_id = p_ministry and ur.role::text in ('servant', 'sub_coordinator')
      and ur.user_id <> p_user
      and (ur.group_id is null or (not gr.is_archived and gr.kind::text <> 'terminal'))
      and (v_gc or ur.group_id = any(v_groups))
    group by ur.user_id, ur.group_id
  ), pres as (
    select ar.servant_id uid, max(ar.service_date) last_present, bool_or(ar.service_date = v_last) at_last
    from attendance_records ar
    where ar.ministry_id = p_ministry and ar.attendee_type::text = 'servant' and ar.event_id is null
      and ar.service_date = any(v_dates)
      and ar.servant_id in (select g.uid from g)
    group by ar.servant_id
  )
  select p.id, p.full_name, p.gender, p.photo_path, p.phone,
         g.gid, gr.name, gr.display_order, g.is_s, g.is_c,
         (select count(*)::int from unnest(v_dates) d
          where d >= coalesce(p.join_date, p.created_at::date) and d > coalesce(pr.last_present, '-infinity'::date)),
         coalesce(pr.at_last, false),
         v_last is not null and coalesce(p.join_date, p.created_at::date) <= v_last,
         v_last,
         ls.seen_at,
         coalesce(ls.seen_at, p.created_at) < now() - make_interval(days => v_s.servant_quiet_days),
         p.birthday_month, p.birthday_day,
         case when p.birthday_month is not null then (
           select min(c - v_today)::int
           from unnest(array[
             notify_bday_this_year(make_date(2000, p.birthday_month, p.birthday_day), v_y - 1),
             notify_bday_this_year(make_date(2000, p.birthday_month, p.birthday_day), v_y),
             notify_bday_this_year(make_date(2000, p.birthday_month, p.birthday_day), v_y + 1)]) c
           where c - v_today between -coalesce(v_s.birthday_window_days_before, 7) and coalesce(v_s.birthday_window_days_after, 14))
         end
  from g
  join profiles p on p.id = g.uid and p.ministry_id = p_ministry and p.deactivated_at is null
  left join groups gr on gr.id = g.gid
  left join pres pr on pr.uid = g.uid
  left join last_seen ls on ls.ministry_id = p_ministry and ls.user_id = g.uid
  order by gr.display_order nulls last, gr.name, p.full_name;
end
$$;

create or replace function my_servant_team()
returns table (person_id uuid, full_name text, gender text, photo_path text, phone text,
               group_id uuid, group_name text, group_order integer,
               is_servant boolean, is_coordinator boolean,
               absent_weeks integer, present_last boolean, counted_last boolean, last_service date,
               last_seen_at timestamptz, quiet boolean,
               birthday_month smallint, birthday_day smallint, birthday_offset integer)
language sql stable security definer as $$
  select * from servant_team(current_ministry_id(), auth.uid())
$$;

-- "Servants: 18 of 24 attended last week, 1 absent 3+ weeks, 2 quiet,
-- 1 birthday" -- null when there's nothing to say.
create or replace function servant_team_line(p_ministry text, p_user uuid)
returns text language plpgsql stable security definer as $$
declare
  v_label text; v_min integer; v_att integer; v_cnt integer; v_abs integer; v_quiet integer; v_bday integer;
  v_last date; v_parts text[] := '{}';
begin
  select coalesce(nullif(trim(s.servant_label), ''), 'Servant'), s.servant_absence_weeks into v_label, v_min
  from app_settings s where s.ministry_id = p_ministry;
  select count(distinct t.person_id) filter (where t.present_last),
         count(distinct t.person_id) filter (where t.counted_last),
         count(distinct t.person_id) filter (where t.absent_weeks >= v_min),
         count(distinct t.person_id) filter (where t.quiet),
         count(distinct t.person_id) filter (where t.birthday_offset is not null),
         max(t.last_service)
    into v_att, v_cnt, v_abs, v_quiet, v_bday, v_last
  from servant_team(p_ministry, p_user) t;
  if v_last is not null and v_cnt > 0 then
    v_parts := v_parts || (v_att || ' of ' || v_cnt || ' attended last week');
  end if;
  if v_abs > 0 then v_parts := v_parts || (v_abs || ' absent ' || v_min || '+ weeks'); end if;
  if v_quiet > 0 then v_parts := v_parts || (v_quiet || ' quiet'); end if;
  if v_bday > 0 then v_parts := v_parts || (v_bday || ' birthday' || case when v_bday = 1 then '' else 's' end); end if;
  if cardinality(v_parts) = 0 then
    return null;
  end if;
  return v_label || 's: ' || array_to_string(v_parts, ', ');
end
$$;

-- 6. Alerts. Servants' birthdays, on the day, to their Coordinators and
-- to every General Coordinator -- with the Birthdays alert.
create or replace function notify_servant_birthdays(p_ministry text, p_today date)
returns integer language plpgsql security definer as $$
declare rec record; v_n integer := 0; v_label text;
begin
  select lower(coalesce(nullif(trim(s.servant_label), ''), 'Servant')) into v_label
  from app_settings s where s.ministry_id = p_ministry;
  for rec in
    with b as (
      select p.id, p.full_name from profiles p
      where p.ministry_id = p_ministry and p.deactivated_at is null and p.birthday_month is not null
        and notify_bday_this_year(make_date(2000, p.birthday_month, p.birthday_day), extract(year from p_today)::int) = p_today
        and exists (select 1 from user_roles ur
                    where ur.ministry_id = p_ministry and ur.user_id = p.id and ur.role::text in ('servant', 'sub_coordinator'))
    ), w as (
      select b.id, b.full_name, gc.user_id uid
      from b join user_roles gc on gc.ministry_id = p_ministry and gc.role::text in ('general_coordinator', 'admin')
      union
      select b.id, b.full_name, c.user_id
      from b
      join user_roles s on s.ministry_id = p_ministry and s.user_id = b.id
                       and s.role::text in ('servant', 'sub_coordinator') and s.group_id is not null
      join groups gr on gr.id = s.group_id and not gr.is_archived and gr.kind::text <> 'terminal'
      join user_roles c on c.ministry_id = p_ministry and c.role::text = 'sub_coordinator' and c.group_id = s.group_id
    )
    select w.uid,
           array_agg(notify_short(w.full_name) order by w.full_name) names,
           array_agg('servant:' || w.id::text || ':' || p_today::text) keys
    from w
    where w.uid <> w.id
      and not exists (select 1 from notification_marks k
                      where k.event = 'birthday' and k.target_user_id = w.uid
                        and k.mark_key = 'servant:' || w.id::text || ':' || p_today::text)
      and notify_wants(p_ministry, w.uid, 'birthday')
    group by w.uid
  loop
    insert into notification_marks (event, target_user_id, mark_key, ministry_id)
    select 'birthday', rec.uid, k, p_ministry from unnest(rec.keys) k on conflict do nothing;
    perform notify_person(p_ministry, 'birthday', rec.uid, 'Birthday today 🎂',
      case when array_length(rec.names, 1) = 1
           then 'Today is ' || rec.names[1] || '''s birthday (one of your ' || v_label || 's).'
           else 'Today is the birthday of ' || notify_names(rec.names) || ' (your ' || v_label || 's).' end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

do $$
declare v text; n text;
begin
  v := pg_get_functiondef('notify_tick()'::regprocedure);
  n := v;
  foreach v in array array[
    E'  v_url text;\nbegin',
    E'      v_queued := v_queued + notify_tasks_due(r.id, v_today);',
    E'        insert into notification_marks (event, target_user_id, mark_key, ministry_id)\n        values (''weekly_recap'', rec.uid, ''week:'' || v_today::text, r.id) on conflict do nothing;\n        if v_y + v_b + v_p + v_g > 0 then',
    E'            array_to_string(v_parts, '' · '') || ''. Tap to see them on your Dashboard.'');'
  ] loop
    if position(v in n) = 0 then
      raise exception 'notify_tick has changed; patch it by hand (missing: %)', v;
    end if;
  end loop;
  n := replace(n, E'  v_url text;\nbegin', E'  v_url text;\n  v_team text;\nbegin');
  n := replace(n, E'      v_queued := v_queued + notify_tasks_due(r.id, v_today);',
    E'      v_queued := v_queued + notify_servant_birthdays(r.id, v_today);\n      v_queued := v_queued + notify_tasks_due(r.id, v_today);');
  n := replace(n,
    E'        insert into notification_marks (event, target_user_id, mark_key, ministry_id)\n        values (''weekly_recap'', rec.uid, ''week:'' || v_today::text, r.id) on conflict do nothing;\n        if v_y + v_b + v_p + v_g > 0 then',
    E'        v_team := servant_team_line(r.id, rec.uid);\n        insert into notification_marks (event, target_user_id, mark_key, ministry_id)\n        values (''weekly_recap'', rec.uid, ''week:'' || v_today::text, r.id) on conflict do nothing;\n        if v_y + v_b + v_p + v_g > 0 or v_team is not null then');
  n := replace(n,
    E'            array_to_string(v_parts, '' · '') || ''. Tap to see them on your Dashboard.'');',
    E'            case when cardinality(v_parts) > 0 then array_to_string(v_parts, '' · '') || ''. '' else '''' end\n            || coalesce(v_team || ''. '', '''') || ''Tap to see them on your Dashboard.'');');
  execute n;
end
$$;

update notification_events
set description = 'On the birthday of each youth assigned to you -- and, for Coordinators and General Coordinators, of their servants.'
where event = 'birthday';
update notification_events
set description = 'How many of your youths need outreach, are newly assigned, have follow-ups due or birthdays coming up -- and, for Coordinators and General Coordinators, how their servants are doing.'
where event = 'weekly_recap';

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['note_seen()', 'my_dashboard_prefs()', 'set_dashboard_pref(text, boolean)',
                           'snooze_birthday_prompt(integer)', 'my_servant_team()'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['servant_team(text, uuid)', 'servant_team_line(text, uuid)',
                           'notify_servant_birthdays(text, date)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;
