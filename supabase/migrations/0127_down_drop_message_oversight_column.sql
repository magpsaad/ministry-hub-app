-- 0127_down_drop_message_oversight_column.sql -- puts the column back, as
-- "No one" everywhere.
--     begin; set local search_path to qa; \i 0127_down_drop_message_oversight_column.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings add column message_oversight text not null default 'none'
  constraint app_settings_message_oversight_check check (message_oversight in ('gc', 'gc_admin', 'none'));
