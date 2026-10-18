-- 0123_down_combined_dashboard.sql -- undoes 0123 (deploy the app that
-- reads the combined Dashboard with separate requests first).
--     begin; set local search_path to qa; \i 0123_down_combined_dashboard.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists combined_dashboard(uuid[], date);
