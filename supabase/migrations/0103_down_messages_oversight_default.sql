-- 0103_down_messages_oversight_default.sql -- undo 0103: the default goes
-- back to 'gc'. Ministries keep whatever they have now (set them in
-- Ministry Settings -> Messages).
--     begin; set local search_path to qa; \i 0103_down_messages_oversight_default.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings alter column message_oversight set default 'gc';
