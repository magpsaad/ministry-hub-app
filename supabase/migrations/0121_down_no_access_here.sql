-- 0121_down_no_access_here.sql -- undoes 0121 (deploy the app without
-- /no-access first: the front door calls my_access_here()).
--     begin; set local search_path to qa; \i 0121_down_no_access_here.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists my_access_here();
