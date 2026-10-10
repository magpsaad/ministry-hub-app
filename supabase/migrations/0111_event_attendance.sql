-- 0111_event_attendance.sql -- ATTENDANCE AT EVENTS, TRIPS AND OUTINGS
-- (owner-approved 10 Oct 2026).
--
-- * Service Calendar: Events, Trips and Outings can "Take attendance"
--   (Coordinators, General Coordinators and Admins only), for the whole
--   ministry, chosen grades, or chosen classes. The classes are kept on the
--   event (audience_group_ids, resolved from the grades when it's saved),
--   so the event keeps counting for the classes that were invited even
--   after they move up a grade.
-- * attendance_records.event_id: a row for an event points at it (deleting
--   the event deletes its attendance). One service-day row per person per
--   day, plus one per person per event (partial unique indexes).
-- * QR check-in also opens during an attendance event's hours (the whole day
--   for an all-day event) for the classes it's for (any event for the
--   Servants code), and records the visit against the event -- and against
--   the service too when service check-in hours are open at the same time.
-- * Service-only measures stay service-only: the yellow outreach cards
--   (notification_yellow) ignore event attendance.
-- * app_settings.using_app_since: when the ministry started using the app;
--   averages never reach back before it. SAY 2025-10-31, HSY 2026-10-09.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0111_event_attendance.sql; commit;
-- Undo with 0111_down_event_attendance.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Ministry: using the app since
-- ---------------------------------------------------------------------
alter table app_settings add column if not exists using_app_since date;
update app_settings set using_app_since = date '2025-10-31' where ministry_id = 'SAY' and using_app_since is null;
update app_settings set using_app_since = date '2026-10-09' where ministry_id = 'HSY' and using_app_since is null;

-- ---------------------------------------------------------------------
-- Calendar events: take attendance, who it's for
-- ---------------------------------------------------------------------
alter table service_calendar_events add column if not exists take_attendance boolean not null default false;
alter table service_calendar_events add column if not exists audience text not null default 'all';
alter table service_calendar_events add column if not exists audience_levels integer[] not null default '{}';
alter table service_calendar_events add column if not exists audience_group_ids uuid[] not null default '{}';
alter table service_calendar_events drop constraint if exists service_calendar_events_audience_check;
alter table service_calendar_events add constraint service_calendar_events_audience_check
  check (audience in ('all', 'grade', 'class'));
alter table service_calendar_events drop constraint if exists service_calendar_events_take_attendance_check;
alter table service_calendar_events add constraint service_calendar_events_take_attendance_check
  check (not take_attendance or event_type::text in ('Event', 'Trip', 'Outing'));
grant insert (take_attendance, audience, audience_levels, audience_group_ids),
      update (take_attendance, audience, audience_levels, audience_group_ids),
      select (take_attendance, audience, audience_levels, audience_group_ids)
  on service_calendar_events to authenticated;

-- Runs as the caller (like guard_person_fields) so current_user tells a
-- person in the app from the system.
create or replace function calendar_attendance_guard()
returns trigger language plpgsql as $$
begin
  if new.take_attendance and new.event_type::text not in ('Event', 'Trip', 'Outing') then
    raise exception 'Attendance can be taken for Events, Trips and Outings only.';
  end if;
  if not new.take_attendance then
    new.audience := 'all'; new.audience_levels := '{}'; new.audience_group_ids := '{}';
  end if;
  if current_user in ('authenticated', 'anon')
     and (case when tg_op = 'INSERT' then new.take_attendance
               else (new.take_attendance, new.audience, new.audience_levels, new.audience_group_ids)
                    is distinct from (old.take_attendance, old.audience, old.audience_levels, old.audience_group_ids) end)
     and not (coalesce(is_admin_or_gc_in(new.ministry_id), false) or coalesce(is_coordinator_in(new.ministry_id), false)) then
    raise exception 'Only Coordinators can choose to take attendance for an event.';
  end if;
  if new.take_attendance then
    if new.audience = 'all' then
      new.audience_levels := '{}'; new.audience_group_ids := '{}';
    elsif new.audience = 'grade' then
      if cardinality(new.audience_levels) = 0 then raise exception 'Choose who the event is for.'; end if;
      new.audience_group_ids := array(select g.id from groups g
                                      where g.ministry_id = new.ministry_id and g.kind::text = 'regular' and not g.is_archived
                                        and g.ladder_position = any(new.audience_levels) order by g.display_order);
      if cardinality(new.audience_group_ids) = 0 then raise exception 'No groups are at that level yet.'; end if;
    else
      new.audience_levels := '{}';
      if cardinality(new.audience_group_ids) = 0 then raise exception 'Choose who the event is for.'; end if;
      if exists (select 1 from unnest(new.audience_group_ids) x
                 where not exists (select 1 from groups g where g.id = x and g.ministry_id = new.ministry_id)) then
        raise exception 'That group was not found.';
      end if;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists trg_calendar_attendance_guard on service_calendar_events;
create trigger trg_calendar_attendance_guard before insert or update on service_calendar_events
  for each row execute function calendar_attendance_guard();

-- Is this event for this class? (Whole-ministry events are for everyone.)
create or replace function event_is_for(p_event uuid, p_group uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from service_calendar_events e
                 where e.id = p_event and e.take_attendance
                   and (e.audience = 'all' or p_group = any(e.audience_group_ids)))
$$;

-- ---------------------------------------------------------------------
-- Attendance rows: which event
-- ---------------------------------------------------------------------
alter table attendance_records add column if not exists event_id uuid references service_calendar_events(id) on delete cascade;
create index if not exists idx_attendance_event on attendance_records (event_id) where event_id is not null;
-- One service-day row per person per day, and one row per person per event
-- (a two-day trip counts once, whichever day they checked in).
alter table attendance_records drop constraint if exists attendance_records_member_id_service_date_key;
alter table attendance_records drop constraint if exists attendance_records_ministry_servant_date_key;
create unique index if not exists uq_attendance_member_day on attendance_records (member_id, service_date) where event_id is null;
create unique index if not exists uq_attendance_member_event on attendance_records (member_id, event_id) where event_id is not null;
create unique index if not exists uq_attendance_servant_day on attendance_records (ministry_id, servant_id, service_date) where event_id is null;
create unique index if not exists uq_attendance_servant_event on attendance_records (servant_id, event_id) where event_id is not null;

-- An event row must belong to an attendance-taking event of the same ministry.
create or replace function attendance_event_guard()
returns trigger language plpgsql security definer as $$
begin
  if new.event_id is not null and not exists (
       select 1 from service_calendar_events e
       where e.id = new.event_id and e.ministry_id = new.ministry_id and e.take_attendance) then
    raise exception 'That event isn''t taking attendance.';
  end if;
  return new;
end
$$;
drop trigger if exists trg_attendance_event_guard on attendance_records;
create trigger trg_attendance_event_guard before insert or update of event_id on attendance_records
  for each row execute function attendance_event_guard();

-- ---------------------------------------------------------------------
-- QR check-in during events
-- ---------------------------------------------------------------------
-- The attendance event happening now for these classes (null groups = any).
create or replace function checkin_event_now(p_ministry text, p_groups uuid[])
returns uuid language sql stable security definer as $$
  select e.id
  from service_calendar_events e, app_settings s
  where s.ministry_id = p_ministry and e.ministry_id = p_ministry and e.take_attendance
    and checkin_today(p_ministry) between e.start_date and e.end_date
    and (e.all_day or e.start_time is null
         or (now() at time zone s.timezone)::time between e.start_time and coalesce(e.end_time, time '23:59:59'))
    and (p_groups is null or e.audience = 'all' or e.audience_group_ids && p_groups)
  order by e.start_date, e.start_time nulls first
  limit 1
$$;

create or replace function checkin_open_any(p_ministry text, p_groups uuid[])
returns boolean language sql stable security definer as $$
  select checkin_is_open(p_ministry) or checkin_event_now(p_ministry, p_groups) is not null
$$;

-- Record a youth's check-in: the service (if its hours are open) and the
-- event happening now for their class (if any). True if anything was new.
create or replace function checkin_record_member(p_ministry text, p_member uuid, p_group uuid, p_visitor boolean)
returns boolean language plpgsql security definer as $$
declare v_new boolean := false; v_id uuid; v_event uuid;
begin
  if checkin_is_open(p_ministry) then
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
    values (p_ministry, 'member', p_member, checkin_today(p_ministry), p_visitor)
    on conflict do nothing
    returning id into v_id;
    v_new := v_new or v_id is not null;
  end if;
  v_event := checkin_event_now(p_ministry, array[p_group]);
  if v_event is not null then
    v_id := null;
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time, event_id)
    values (p_ministry, 'member', p_member, checkin_today(p_ministry), p_visitor, v_event)
    on conflict do nothing
    returning id into v_id;
    v_new := v_new or v_id is not null;
  end if;
  return v_new;
end
$$;

create or replace function checkin_record_servant(p_ministry text, p_servant uuid)
returns boolean language plpgsql security definer as $$
declare v_new boolean := false; v_id uuid; v_event uuid;
begin
  if checkin_is_open(p_ministry) then
    insert into attendance_records (ministry_id, attendee_type, servant_id, service_date)
    values (p_ministry, 'servant', p_servant, checkin_today(p_ministry))
    on conflict do nothing
    returning id into v_id;
    v_new := v_new or v_id is not null;
  end if;
  v_event := checkin_event_now(p_ministry, null);
  if v_event is not null then
    v_id := null;
    insert into attendance_records (ministry_id, attendee_type, servant_id, service_date, event_id)
    values (p_ministry, 'servant', p_servant, checkin_today(p_ministry), v_event)
    on conflict do nothing
    returning id into v_id;
    v_new := v_new or v_id is not null;
  end if;
  return v_new;
end
$$;

-- Patch the existing check-in functions to use those (refuses if a
-- function doesn't read as expected).
do $$
declare
  v text;
begin
  -- checkin_window: open during service hours or an event for this code's classes
  v := pg_get_functiondef('checkin_window(uuid)'::regprocedure);
  if position('select r_ministry_id into v_m from checkin_resolve(p_token);' in v) = 0
     or position('return query select checkin_is_open(v_m),' in v) = 0 then
    raise exception 'checkin_window has changed; patch it by hand';
  end if;
  v := replace(v, 'declare v_m text;', 'declare v_m text; v_g uuid;');
  v := replace(v, 'select r_ministry_id into v_m from checkin_resolve(p_token);',
                  'select r_ministry_id, r_group_id into v_m, v_g from checkin_resolve(p_token);');
  v := replace(v, 'return query select checkin_is_open(v_m),',
                  'return query select checkin_open_any(v_m, case when v_g is null then null else checkin_served_groups(v_m, v_g) end),');
  execute v;

  -- checkin_mark_attendance
  v := pg_get_functiondef('checkin_mark_attendance(uuid, uuid)'::regprocedure);
  if position('if not checkin_is_open(v_m) then' in v) = 0 or position(E'on conflict (member_id, service_date) do nothing\n  returning id into v_inserted_id;' in v) = 0 then
    raise exception 'checkin_mark_attendance has changed; patch it by hand';
  end if;
  v := replace(v, 'if not checkin_is_open(v_m) then', 'if not checkin_open_any(v_m, array[v_member.group_id]) then');
  v := regexp_replace(v, E'insert into attendance_records \\(ministry_id, attendee_type, member_id, service_date, is_visitor_at_time\\)\\s*values \\(v_m, ''member'', p_member_id, checkin_today\\(v_m\\), coalesce\\(v_member.is_visitor, false\\)\\)\\s*on conflict \\(member_id, service_date\\) do nothing\\s*returning id into v_inserted_id;',
                      'v_inserted_id := case when checkin_record_member(v_m, p_member_id, v_member.group_id, coalesce(v_member.is_visitor, false)) then p_member_id end;');
  if position('checkin_record_member' in v) = 0 then raise exception 'checkin_mark_attendance: insert not replaced'; end if;
  execute v;

  -- checkin_mark_servant_attendance
  v := pg_get_functiondef('checkin_mark_servant_attendance(uuid, uuid)'::regprocedure);
  if position('if not checkin_is_open(v_m) then' in v) = 0 then
    raise exception 'checkin_mark_servant_attendance has changed; patch it by hand';
  end if;
  v := replace(v, 'if not checkin_is_open(v_m) then', 'if not checkin_open_any(v_m, null) then');
  v := regexp_replace(v, E'insert into attendance_records \\(ministry_id, attendee_type, servant_id, service_date\\)\\s*values \\(v_m, ''servant'', p_servant_id, checkin_today\\(v_m\\)\\)\\s*on conflict \\(ministry_id, servant_id, service_date\\) do nothing\\s*returning id into v_inserted_id;',
                      'v_inserted_id := case when checkin_record_servant(v_m, p_servant_id) then p_servant_id end;');
  if position('checkin_record_servant' in v) = 0 then raise exception 'checkin_mark_servant_attendance: insert not replaced'; end if;
  execute v;

  -- checkin_resolve_duplicate_member
  v := pg_get_functiondef('checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean, text, text, text, text, text, text)'::regprocedure);
  if position('if not checkin_is_open(v_m) then' in v) = 0 then
    raise exception 'checkin_resolve_duplicate_member has changed; patch it by hand';
  end if;
  v := replace(v, 'if not checkin_is_open(v_m) then', 'if not checkin_open_any(v_m, array[v_mem.group_id]) then');
  v := regexp_replace(v, E'insert into attendance_records \\(ministry_id, attendee_type, member_id, service_date, is_visitor_at_time\\)\\s*values \\(v_m, ''member'', v_id, checkin_today\\(v_m\\), coalesce\\(v_mem.is_visitor, false\\)\\)\\s*on conflict \\(member_id, service_date\\) do nothing\\s*returning id into v_inserted;',
                      'v_inserted := case when checkin_record_member(v_m, v_id, v_mem.group_id, coalesce(v_mem.is_visitor, false)) then v_id end;');
  if position('checkin_record_member' in v) = 0 then raise exception 'checkin_resolve_duplicate_member: insert not replaced'; end if;
  execute v;

  -- checkin_submit_new_member
  v := pg_get_functiondef('checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text, text, text, text, text, text, text)'::regprocedure);
  if position('checkin_is_open(v_m) then' in v) = 0 then
    raise exception 'checkin_submit_new_member has changed; patch it by hand';
  end if;
  v := regexp_replace(v, E'if v_flow = ''check_in_and_intake'' and checkin_is_open\\(v_m\\) then\\s*insert into attendance_records \\(ministry_id, attendee_type, member_id, service_date\\)\\s*values \\(v_m, ''member'', v_new_member_id, checkin_today\\(v_m\\)\\)\\s*on conflict \\(member_id, service_date\\) do nothing;',
                      E'if v_flow = ''check_in_and_intake'' and checkin_open_any(v_m, array[v_placed]) then\n    perform checkin_record_member(v_m, v_new_member_id, v_placed, false);');
  if position('checkin_record_member' in v) = 0 then raise exception 'checkin_submit_new_member: insert not replaced'; end if;
  execute v;

  -- link_pending_servant: the servant unique rule is now a partial index
  v := pg_get_functiondef('link_pending_servant(uuid, uuid)'::regprocedure);
  if position('on conflict (ministry_id, servant_id, service_date) do nothing' in v) = 0 then
    raise exception 'link_pending_servant has changed; patch it by hand';
  end if;
  execute replace(v, 'on conflict (ministry_id, servant_id, service_date) do nothing', 'on conflict do nothing');

  -- merge_servant_accounts: a service day and an event on the same day are different rows
  v := pg_get_functiondef('merge_servant_accounts(uuid, uuid)'::regprocedure);
  if position('and k.service_date = ar.service_date' in v) = 0 then
    raise exception 'merge_servant_accounts has changed; patch it by hand';
  end if;
  execute replace(v, 'and k.service_date = ar.service_date',
                     'and k.service_date = ar.service_date and k.event_id is not distinct from ar.event_id');

  -- notification_yellow: outreach cards count service attendance only
  v := pg_get_functiondef('notification_yellow(text)'::regprocedure);
  if (length(v) - length(replace(v, 'where ar.attendee_type::text = ''member'' and ar.member_id = m.id', ''))) / length('where ar.attendee_type::text = ''member'' and ar.member_id = m.id') <> 2 then
    raise exception 'notification_yellow has changed; patch it by hand';
  end if;
  execute replace(v, 'where ar.attendee_type::text = ''member'' and ar.member_id = m.id',
                     'where ar.attendee_type::text = ''member'' and ar.member_id = m.id and ar.event_id is null');
end
$$;

-- The name search, the name lookup and "fill in your details" open with
-- the window too (the Servants code: any event; a class code: its events).
do $$
declare
  v text; f text;
  served text := 'checkin_open_any(v_m, checkin_served_groups(v_m, v_group_id))';
begin
  foreach f in array array['checkin_search_members(uuid, text)', 'checkin_get_member(uuid, uuid)',
                           'checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text, text, text, text, text, text, text)'] loop
    v := pg_get_functiondef(f::regprocedure);
    if position('not checkin_is_open(v_m)' in v) = 0 then raise exception '% has changed; patch it by hand', f; end if;
    execute replace(v, 'not checkin_is_open(v_m)', 'not ' || served);
  end loop;
  foreach f in array array['checkin_search_servants(uuid, text)', 'checkin_get_servant(uuid, uuid, text)'] loop
    v := pg_get_functiondef(f::regprocedure);
    if position('not checkin_is_open(v_m)' in v) = 0 then raise exception '% has changed; patch it by hand', f; end if;
    execute replace(v, 'not checkin_is_open(v_m)', 'not checkin_open_any(v_m, null)');
  end loop;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['calendar_attendance_guard()', 'event_is_for(uuid, uuid)', 'attendance_event_guard()',
                           'checkin_event_now(text, uuid[])', 'checkin_open_any(text, uuid[])',
                           'checkin_record_member(text, uuid, uuid, boolean)', 'checkin_record_servant(text, uuid)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- One-time (owner-requested): every HSY youth already in the app joined on
-- the launch day, 9 Oct 2026; youths added since keep their own dates.
-- ---------------------------------------------------------------------
update members set join_date = date '2026-10-09'
where ministry_id = 'HSY' and created_at < timestamptz '2026-10-10 00:00 America/Toronto'
  and join_date is distinct from date '2026-10-09';
