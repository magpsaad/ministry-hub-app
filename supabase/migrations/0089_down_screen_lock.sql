-- 0089_down_screen_lock.sql -- undoes 0089: no screen lock, no Face ID unlock
-- devices (their registrations are deleted; people would set them up again).
--     begin; set local search_path to qa; \i 0089_down_screen_lock.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists reset_person_unlock_devices(uuid);
drop function if exists remove_unlock_device(uuid);
drop function if exists use_unlock_device(text, bigint);
drop function if exists add_unlock_device(text, text, bigint, text[], text, text);
drop function if exists unlock_session();
drop function if exists screen_lock_state(boolean);
drop function if exists app_server_check();
drop function if exists my_session_id();
drop table if exists unlock_devices;
drop table if exists session_activity;
alter table app_settings drop column if exists idle_lock_minutes;
