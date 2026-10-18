-- 0124_down_settings_for_shared_cache.sql -- undoes 0124 (deploy the app
-- that reads these lists with the person's sign-in first).
--     begin; set local search_path to qa; \i 0124_down_settings_for_shared_cache.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists ministry_actions_needed_config();
drop function if exists ministry_active_verses();
