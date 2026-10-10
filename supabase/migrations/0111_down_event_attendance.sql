-- 0111_down_event_attendance.sql -- undo 0111. Event attendance rows are
-- DELETED (they can't fit the old one-row-per-day rule). The HSY join-date
-- change is not undone (the old dates aren't kept).
--     begin; set local search_path to qa; \i 0111_down_event_attendance.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

do $$
declare v text; f text;
begin
  v := pg_get_functiondef('checkin_window(uuid)'::regprocedure);
  v := replace(v, 'declare v_m text; v_g uuid;', 'declare v_m text;');
  v := replace(v, 'select r_ministry_id, r_group_id into v_m, v_g from checkin_resolve(p_token);',
                  'select r_ministry_id into v_m from checkin_resolve(p_token);');
  v := replace(v, 'return query select checkin_open_any(v_m, case when v_g is null then null else checkin_served_groups(v_m, v_g) end),',
                  'return query select checkin_is_open(v_m),');
  execute v;

  v := pg_get_functiondef('checkin_mark_attendance(uuid, uuid)'::regprocedure);
  v := replace(v, 'if not checkin_open_any(v_m, array[v_member.group_id]) then', 'if not checkin_is_open(v_m) then');
  v := replace(v, 'v_inserted_id := case when checkin_record_member(v_m, p_member_id, v_member.group_id, coalesce(v_member.is_visitor, false)) then p_member_id end;',
    E'insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)\n  values (v_m, ''member'', p_member_id, checkin_today(v_m), coalesce(v_member.is_visitor, false))\n  on conflict (member_id, service_date) do nothing\n  returning id into v_inserted_id;');
  execute v;

  v := pg_get_functiondef('checkin_mark_servant_attendance(uuid, uuid)'::regprocedure);
  v := replace(v, 'if not checkin_open_any(v_m, null) then', 'if not checkin_is_open(v_m) then');
  v := replace(v, 'v_inserted_id := case when checkin_record_servant(v_m, p_servant_id) then p_servant_id end;',
    E'insert into attendance_records (ministry_id, attendee_type, servant_id, service_date)\n  values (v_m, ''servant'', p_servant_id, checkin_today(v_m))\n  on conflict (ministry_id, servant_id, service_date) do nothing\n  returning id into v_inserted_id;');
  execute v;

  v := pg_get_functiondef('checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean, text, text, text, text, text, text)'::regprocedure);
  v := replace(v, 'if not checkin_open_any(v_m, array[v_mem.group_id]) then', 'if not checkin_is_open(v_m) then');
  v := replace(v, 'v_inserted := case when checkin_record_member(v_m, v_id, v_mem.group_id, coalesce(v_mem.is_visitor, false)) then v_id end;',
    E'insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)\n  values (v_m, ''member'', v_id, checkin_today(v_m), coalesce(v_mem.is_visitor, false))\n  on conflict (member_id, service_date) do nothing\n  returning id into v_inserted;');
  execute v;

  v := pg_get_functiondef('checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text, text, text, text, text, text, text)'::regprocedure);
  v := replace(v, E'if v_flow = ''check_in_and_intake'' and checkin_open_any(v_m, array[v_placed]) then\n    perform checkin_record_member(v_m, v_new_member_id, v_placed, false);',
    E'if v_flow = ''check_in_and_intake'' and checkin_is_open(v_m) then\n    insert into attendance_records (ministry_id, attendee_type, member_id, service_date)\n    values (v_m, ''member'', v_new_member_id, checkin_today(v_m))\n    on conflict (member_id, service_date) do nothing;');
  execute v;

  foreach f in array array['checkin_search_members(uuid, text)', 'checkin_get_member(uuid, uuid)',
                           'checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text, text, text, text, text, text, text)'] loop
    execute replace(pg_get_functiondef(f::regprocedure), 'not checkin_open_any(v_m, checkin_served_groups(v_m, v_group_id))', 'not checkin_is_open(v_m)');
  end loop;
  foreach f in array array['checkin_search_servants(uuid, text)', 'checkin_get_servant(uuid, uuid, text)'] loop
    execute replace(pg_get_functiondef(f::regprocedure), 'not checkin_open_any(v_m, null)', 'not checkin_is_open(v_m)');
  end loop;

  v := pg_get_functiondef('link_pending_servant(uuid, uuid)'::regprocedure);
  execute replace(v, E'on conflict do nothing;

  update pending_servants', E'on conflict (ministry_id, servant_id, service_date) do nothing;

  update pending_servants');

  v := pg_get_functiondef('merge_servant_accounts(uuid, uuid)'::regprocedure);
  execute replace(v, 'and k.service_date = ar.service_date and k.event_id is not distinct from ar.event_id',
                     'and k.service_date = ar.service_date');

  v := pg_get_functiondef('notification_yellow(text)'::regprocedure);
  execute replace(v, 'and ar.member_id = m.id and ar.event_id is null', 'and ar.member_id = m.id');
end
$$;

drop function if exists checkin_record_member(text, uuid, uuid, boolean);
drop function if exists checkin_record_servant(text, uuid);
drop function if exists checkin_open_any(text, uuid[]);
drop function if exists checkin_event_now(text, uuid[]);
drop function if exists event_is_for(uuid, uuid);

delete from attendance_records where event_id is not null;
drop trigger if exists trg_attendance_event_guard on attendance_records;
drop function if exists attendance_event_guard();
drop index if exists uq_attendance_member_day;
drop index if exists uq_attendance_member_event;
drop index if exists uq_attendance_servant_day;
drop index if exists uq_attendance_servant_event;
alter table attendance_records drop column if exists event_id;
alter table attendance_records add constraint attendance_records_member_id_service_date_key unique (member_id, service_date);
alter table attendance_records add constraint attendance_records_ministry_servant_date_key unique (ministry_id, servant_id, service_date);

drop trigger if exists trg_calendar_attendance_guard on service_calendar_events;
drop function if exists calendar_attendance_guard();
alter table service_calendar_events drop constraint if exists service_calendar_events_take_attendance_check;
alter table service_calendar_events drop constraint if exists service_calendar_events_audience_check;
alter table service_calendar_events drop column if exists audience_group_ids;
alter table service_calendar_events drop column if exists audience_levels;
alter table service_calendar_events drop column if exists audience;
alter table service_calendar_events drop column if exists take_attendance;

alter table app_settings drop column if exists using_app_since;
