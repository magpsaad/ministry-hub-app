-- 0106_down_coordinator_scopes.sql -- undo 0106. The per-class Coordinator
-- grants the scopes made are KEPT (as ordinary per-class grants); only the
-- grade-level scopes, the setting and the automatic re-check go.
--     begin; set local search_path to qa; \i 0106_down_coordinator_scopes.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- QA only: the refresh stops copying scopes.
do $$
declare v_def text;
begin
  if current_schema() <> 'qa' then return; end if;
  v_def := pg_get_functiondef('qa.refresh_from_prod(text[], jsonb, boolean)'::regprocedure);
  if position('coordinator_scopes' in v_def) = 0 then return; end if;
  execute replace(replace(v_def, E' ''coordinator_scopes'', ''user_roles'',', E' ''user_roles'','),
                  E' ''user_roles'', ''coordinator_scopes'',', E' ''user_roles'',');
end
$$;

drop trigger if exists trg_sync_coordinator_scopes on groups;
drop function if exists sync_coordinator_scopes_on_group();
drop function if exists grant_coordinator_scope(uuid, integer, text);
drop function if exists revoke_coordinator_scope(uuid);

-- Keep the grants: detach them before the scopes go.
update user_roles set scope_id = null where scope_id is not null;

create or replace function revoke_role_grant(p_role_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_role app_role; v_user_id uuid; v_group uuid;
begin
  select role, user_id, group_id into v_role, v_user_id, v_group from user_roles where id = p_role_id and ministry_id = v_m;
  if not (is_admin_or_gc_in(v_m)
          or (v_role = 'servant' and coordinates_group(v_m, v_group))) then
    raise exception 'Only General Coordinators/Admins can revoke a role grant (Coordinators: Servants of their own groups only)';
  end if;
  if v_role is null then raise exception 'Role grant not found'; end if;
  if v_role in ('admin', 'general_coordinator') then
    raise exception 'Admin and General Coordinator grants can only be revoked from Access Maintenance';
  end if;
  if v_role = 'servant' then
    update members set assigned_servant_id = null, is_new_assignment = false
    where ministry_id = v_m and assigned_servant_id = v_user_id;
  end if;
  delete from user_roles where id = p_role_id and ministry_id = v_m;
end
$$;

drop function if exists sync_coordinator_scope(uuid);
drop index if exists idx_user_roles_scope;
alter table user_roles drop column if exists scope_id;
drop table if exists coordinator_scopes;
alter table app_settings drop constraint if exists app_settings_coordinator_scope_check;
alter table app_settings drop column if exists coordinator_scope;

do $$
declare s text := current_schema();
begin
  execute format('alter function revoke_role_grant(uuid) set search_path = %I, public, pg_temp', s);
  execute 'revoke all on function revoke_role_grant(uuid) from public, anon, authenticated';
  execute 'grant execute on function revoke_role_grant(uuid) to authenticated, service_role';
end
$$;
