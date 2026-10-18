-- 0127_drop_message_oversight_column.sql -- the "Can read all messages"
-- setting's column goes (owner-requested 18 Oct 2026, follows 0126). Run
-- only AFTER the app that no longer reads app_settings.message_oversight is
-- live: the older app asks for the column on every page.
--     begin; set local search_path to qa; \i 0127_drop_message_oversight_column.sql; commit;
-- Undo with 0127_down_drop_message_oversight_column.sql.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings drop column message_oversight;
