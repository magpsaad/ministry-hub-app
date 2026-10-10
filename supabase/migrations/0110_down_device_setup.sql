-- 0110_down_device_setup.sql -- undo 0110 (the Device setup view and the
-- record of who opened the app from its home screen icon).
--     begin; set local search_path to qa; \i 0110_down_device_setup.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists device_setup();
drop function if exists note_home_icon();
drop table if exists home_icon_opens;
