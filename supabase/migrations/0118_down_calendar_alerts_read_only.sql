-- 0118_down_calendar_alerts_read_only.sql -- undoes 0118.
--     begin; set local search_path to qa; \i 0118_down_calendar_alerts_read_only.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

do $$
declare v text;
begin
  v := pg_get_functiondef('notify_tick()'::regprocedure);
  execute replace(v, E'      v_queued := v_queued + notify_calendar_changes(r.id);\n', '');
  v := pg_get_functiondef('add_member_photo(uuid, text)'::regprocedure);
  execute replace(v,
    E'  if not (v_group_id = any (accessible_group_ids(false)))\n'
    || E'     and not coalesce((select s.read_only_can_add_photos from app_settings s where s.ministry_id = current_ministry_id()), true) then\n'
    || E'    raise exception ''Read-only access can''''t add photos in this ministry'';\n'
    || E'  end if;\n', '');
end
$$;

drop trigger if exists trg_calendar_note_change on service_calendar_events;
drop function if exists calendar_note_change();
drop function if exists notify_calendar_changes(text);
drop table if exists calendar_changes;
delete from notification_marks where event = 'calendar';
delete from notification_preferences where event = 'calendar';
delete from notification_ministry_defaults where event = 'calendar';
delete from notification_events where event = 'calendar';

drop policy if exists attendance_insert_read_only on attendance_records;
drop policy if exists attendance_delete_read_only on attendance_records;
drop function if exists readonly_attendance_on();
alter table app_settings drop column if exists read_only_can_add_photos, drop column if exists read_only_can_take_attendance;
