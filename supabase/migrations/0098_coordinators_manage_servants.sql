-- 0098_coordinators_manage_servants.sql -- COORDINATORS CAN ASSIGN SERVANTS
-- (owner-requested 8 Oct 2026). On Servant Assignments, a (sub-)Coordinator
-- can now help the General Coordinator: add someone as a Servant of a group
-- they coordinate, move a Servant into or out of their groups, and remove a
-- Servant from their groups. Servant roles only -- making someone a
-- Coordinator or Read-only, and anything outside their own groups, stays
-- with General Coordinators and Admins (unchanged). Run once per
-- environment, QA first:
--     begin; set local search_path to qa; \i 0098_coordinators_manage_servants.sql; commit;
-- Undo with 0098_down_coordinators_manage_servants.sql.
-- Audit entries are written by the app's actions, as before.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- Is this person a Coordinator of that group (same sign-in rules as
-- is_coordinator_in)?
create or replace function coordinates_group(m text, g uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select g is not null and ministry_exists(m) and ministry_is_active(m) and factor_ok(uid)
     and exists (select 1 from user_roles
                 where ministry_id = m and user_id = uid and role = 'sub_coordinator' and group_id = g);
$$;

create or replace function grant_servant_role(p_user_id uuid, p_role app_role, p_group_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_new_id uuid;
begin
  if not (is_admin_or_gc_in(v_m)
          or (p_role = 'servant' and coordinates_group(v_m, p_group_id))) then
    raise exception 'Only General Coordinators/Admins can grant a role here (Coordinators: Servants of their own groups only)';
  end if;
  if p_role not in ('servant', 'sub_coordinator', 'read_only') then
    raise exception 'Only Servant, Sub-Coordinator, or Read-Only grants can be added here -- use Access Maintenance for Admin/General Coordinator roles';
  end if;
  if p_group_id is not null and not exists (select 1 from groups where id = p_group_id and ministry_id = v_m) then
    raise exception 'Group not found';
  end if;
  if not exists (select 1 from user_roles where ministry_id = v_m and user_id = p_user_id) then
    raise exception 'This person has no existing role grant yet -- use Access Maintenance to grant their first one';
  end if;
  if exists (select 1 from user_roles where ministry_id = v_m and user_id = p_user_id and role = p_role
             and group_id is not distinct from p_group_id) then
    raise exception 'This person already holds that exact role/group grant';
  end if;
  insert into user_roles (ministry_id, user_id, role, group_id) values (v_m, p_user_id, p_role, p_group_id)
  returning id into v_new_id;
  return v_new_id;
end
$$;

create or replace function reassign_role_group(p_role_id uuid, p_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_role app_role;
  v_user uuid;
  v_old uuid;
begin
  select role, user_id, group_id into v_role, v_user, v_old from user_roles where id = p_role_id and ministry_id = v_m;
  -- A Coordinator may move a Servant between their own groups, or between
  -- one of them and Unassigned.
  if not (is_admin_or_gc_in(v_m)
          or (v_role = 'servant'
              and (v_old is not null or p_group_id is not null)
              and (v_old is null or coordinates_group(v_m, v_old))
              and (p_group_id is null or coordinates_group(v_m, p_group_id)))) then
    raise exception 'Only General Coordinators/Admins can reassign a role grant (Coordinators: Servants of their own groups only)';
  end if;
  if v_role is null then raise exception 'Role grant not found'; end if;
  if v_role <> 'servant' then raise exception 'Only Servant grants can be reassigned to a different group here'; end if;
  if p_group_id is not null and not exists (select 1 from groups where id = p_group_id and ministry_id = v_m) then
    raise exception 'Group not found';
  end if;
  update user_roles set group_id = p_group_id where id = p_role_id and ministry_id = v_m;
  if v_old is not null and v_old is distinct from p_group_id then
    update members set assigned_servant_id = null, is_new_assignment = false
    where ministry_id = v_m and group_id = v_old and assigned_servant_id = v_user;
  end if;
end
$$;

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

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['coordinates_group(text, uuid, uuid)', 'grant_servant_role(uuid, app_role, uuid)',
                           'reassign_role_group(uuid, uuid)', 'revoke_role_grant(uuid)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
  execute 'revoke all on function coordinates_group(text, uuid, uuid) from public, anon';
  execute 'grant execute on function coordinates_group(text, uuid, uuid) to authenticated, service_role';
end
$$;
