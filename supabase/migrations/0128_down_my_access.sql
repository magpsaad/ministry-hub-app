-- 0128_down_my_access.sql -- undoes 0128 (deploy the app that reads
-- user_roles and is_church_admin() separately first).
--     begin; set local search_path to qa; \i 0128_down_my_access.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists my_access();
