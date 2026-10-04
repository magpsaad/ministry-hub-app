-- 0079_two_step_signin.sql -- TWO-STEP SIGN-IN (owner-approved sign-in change B,
-- 3 Oct 2026: an authenticator app is REQUIRED for Admins, General
-- Coordinators and the Church Admin, and OPTIONAL "extra security" for
-- everyone else -- "make it meaningful").
-- Run once per environment, QA first, together with the app code that adds
-- the /security pages (the app sends people there; this makes the database
-- refuse to act on a sign-in that skipped the step):
--     begin; set local search_path to qa; \i 0079_two_step_signin.sql; commit;
-- Undo with 0079_down_two_step_signin.sql.
--
-- A sign-in that has passed the authenticator step carries `aal2` in its
-- token; one that hasn't carries `aal1`.
-- * aal2_ok(uid): the person's own request is at aal2. Checks about SOMEONE
--   ELSE, and work done directly in the database (no sign-in token), pass.
-- * factor_ok(uid): aal2_ok, or the person has no authenticator set up.
-- * Church Admin, Admin and General Coordinator powers need aal2_ok -- at
--   aal1 those people count only as whatever class role they also hold.
-- * Everything else a role gives (a class, Coordinator of a class,
--   Read-Only, being an app user at all) needs factor_ok -- so someone who
--   turned on the optional authenticator is protected the same way: a
--   sign-in by email alone sees nothing until the authenticator step.
-- * reset_person_authenticator(person): an Admin/Church Admin clears a
--   lost phone's authenticator so the person can set it up again.
-- * gate_info(): what the app's front door needs, read WITHOUT these
--   checks (is this person a Church Admin; must they use an authenticator
--   here) so it can send them to set it up or enter it.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function aal2_ok(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select uid is distinct from auth.uid()
      or auth.jwt() is null
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function factor_ok(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select aal2_ok(uid)
      or not exists (select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified');
$$;

create or replace function gate_info()
returns table (church_admin boolean, mfa_required boolean)
language sql stable security definer as $$
  with me as (select auth.uid() as uid, current_ministry_id() as m)
  select exists (select 1 from church_admins c where c.user_id = me.uid),
         exists (select 1 from church_admins c where c.user_id = me.uid)
           or exists (select 1 from user_roles ur
                      where ur.ministry_id = me.m and ur.user_id = me.uid
                        and ur.role in ('admin', 'general_coordinator'))
  from me where me.uid is not null;
$$;

create or replace function is_church_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select exists (select 1 from church_admins where user_id = uid) and aal2_ok(uid);
$$;

create or replace function is_admin_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and aal2_ok(uid)
        and exists (select 1 from user_roles where ministry_id = m and user_id = uid and role = 'admin'))
  );
$$;

create or replace function is_admin_or_gc_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and aal2_ok(uid) and exists (
      select 1 from user_roles where ministry_id = m and user_id = uid and role in ('admin', 'general_coordinator')))
  );
$$;

create or replace function is_coordinator_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and (
          (aal2_ok(uid) and exists (select 1 from user_roles where ministry_id = m and user_id = uid
                                    and role in ('admin', 'general_coordinator')))
          or (factor_ok(uid) and exists (select 1 from user_roles where ministry_id = m and user_id = uid
                                         and role = 'sub_coordinator'))))
  );
$$;

create or replace function is_app_user_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and factor_ok(uid)
        and exists (select 1 from user_roles where ministry_id = m and user_id = uid))
  );
$$;

create or replace function accessible_group_ids(p_include_read_only boolean default true)
returns uuid[] language sql stable security definer as $$
  with me as (
    select auth.uid() as uid, current_ministry_id() as m
  ), f as (
    select me.uid, me.m,
           exists (select 1 from church_admins c where c.user_id = me.uid) and aal2_ok(me.uid) as church_admin,
           exists (select 1 from ministries mi where mi.id = me.m and mi.is_active) as active,
           exists (select 1 from user_roles ur
                   where ur.ministry_id = me.m and ur.user_id = me.uid and ur.role = 'admin') and aal2_ok(me.uid) as admin,
           exists (select 1 from user_roles ur
                   where ur.ministry_id = me.m and ur.user_id = me.uid and ur.role = 'general_coordinator') and aal2_ok(me.uid) as gc,
           factor_ok(me.uid) as class_ok
    from me
  )
  select coalesce(array_agg(g.id), '{}'::uuid[])
  from groups g, f
  where g.ministry_id = f.m
    and (f.church_admin
         or (f.active and (f.admin
             or (g.kind = 'regular' and (f.gc
                 or (f.class_ok and exists (select 1 from user_roles ur
                            where ur.ministry_id = f.m and ur.user_id = f.uid and ur.group_id = g.id
                              and (p_include_read_only or ur.role <> 'read_only'))))))));
$$;

create or replace function has_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce((
    select g.ministry_id = current_ministry_id()
       and (is_admin_in(g.ministry_id, uid)
            or (g.kind = 'regular'
                and (is_admin_or_gc_in(g.ministry_id, uid)
                     or (ministry_is_active(g.ministry_id) and factor_ok(uid) and exists (
                           select 1 from user_roles ur
                           where ur.user_id = uid and ur.group_id = gid and ur.role <> 'read_only')))))
    from groups g where g.id = gid
  ), false);
$$;

create or replace function has_readonly_or_full_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select has_group_access(gid, uid) or coalesce((
    select g.ministry_id = current_ministry_id()
       and g.kind = 'regular'
       and ministry_is_active(g.ministry_id)
       and factor_ok(uid)
       and exists (select 1 from user_roles ur
                   where ur.user_id = uid and ur.group_id = gid and ur.role = 'read_only')
    from groups g where g.id = gid
  ), false);
$$;

create or replace function storage_photo_read_allowed(p_name text)
returns boolean language sql stable security definer as $$
  with x as (
    select (storage.foldername(p_name))[1] as m, (storage.foldername(p_name))[2] as kind, auth.uid() as uid
  )
  select case
    when x.uid is null or coalesce(x.m, '') !~ '^[A-Z]{3}$' then false
    when not is_app_user_in(x.m, x.uid) then false
    when x.kind = 'profiles' then true
    when x.kind = 'members' then exists (
      select 1
      from members mem
      join groups g on g.id = mem.group_id
      where mem.ministry_id = x.m and mem.photo_path = p_name
        and (is_church_admin(x.uid)
             or (aal2_ok(x.uid) and exists (select 1 from user_roles ur where ur.ministry_id = x.m and ur.user_id = x.uid and ur.role = 'admin'))
             or (g.kind = 'regular' and (
                   (aal2_ok(x.uid) and exists (select 1 from user_roles ur
                                               where ur.ministry_id = x.m and ur.user_id = x.uid and ur.role = 'general_coordinator'))
                   or (factor_ok(x.uid) and exists (select 1 from user_roles ur
                                                    where ur.ministry_id = x.m and ur.user_id = x.uid and ur.group_id = g.id))))))
    else false
  end
  from x;
$$;

-- Lost or replaced phone: an Admin of this ministry (past their own
-- authenticator step) or the Church Admin clears someone's authenticator;
-- at their next sign-in that person sets it up again on the new phone.
-- Returns how many were cleared (0 = they had none).
create or replace function reset_person_authenticator(p_user_id uuid)
returns integer language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_n integer;
begin
  if not (is_admin_in(v_m) or is_church_admin()) then
    raise exception 'Only Admins can reset someone''s authenticator';
  end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = p_user_id) and not is_church_admin() then
    raise exception 'Person not found';
  end if;
  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

do $$
declare
  s text := current_schema();
  f text;
begin
  foreach f in array array[
    'aal2_ok(uuid)', 'factor_ok(uuid)', 'gate_info()', 'is_church_admin(uuid)', 'is_admin_in(text, uuid)',
    'is_admin_or_gc_in(text, uuid)', 'is_coordinator_in(text, uuid)', 'is_app_user_in(text, uuid)',
    'accessible_group_ids(boolean)', 'has_group_access(uuid, uuid)', 'has_readonly_or_full_group_access(uuid, uuid)',
    'storage_photo_read_allowed(text)', 'reset_person_authenticator(uuid)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
  -- New functions: no anonymous use. The replaced ones keep their grants.
  execute 'revoke all on function aal2_ok(uuid) from public, anon';
  execute 'revoke all on function factor_ok(uuid) from public, anon';
  execute 'revoke all on function gate_info() from public, anon';
  execute 'grant execute on function aal2_ok(uuid) to authenticated, service_role';
  execute 'grant execute on function factor_ok(uuid) to authenticated, service_role';
  execute 'grant execute on function gate_info() to authenticated, service_role';
  execute 'revoke all on function reset_person_authenticator(uuid) from public, anon';
  execute 'grant execute on function reset_person_authenticator(uuid) to authenticated, service_role';
end
$$;
