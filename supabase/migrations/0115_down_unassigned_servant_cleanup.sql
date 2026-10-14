-- 0115_down_unassigned_servant_cleanup.sql -- undo 0115 (removed leftover
-- grants are not restored).
--     begin; set local search_path to qa; \i 0115_down_unassigned_servant_cleanup.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop trigger if exists trg_drop_unassigned_servant on user_roles;
drop function if exists drop_unassigned_servant();

do $$
declare v text;
begin
  v := pg_get_functiondef('revoke_role_grant(uuid)'::regprocedure);
  execute replace(v,
    E'where ministry_id = v_m and assigned_servant_id = v_user_id and v_group is not null and group_id = v_group;',
    E'where ministry_id = v_m and assigned_servant_id = v_user_id;');
end
$$;
