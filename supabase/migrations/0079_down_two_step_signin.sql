-- 0079_down_two_step_signin.sql -- undoes 0079: the role checks no longer look at
-- the authenticator step, and aal2_ok / factor_ok / gate_info are dropped.
-- (The app's /security pages then simply aren't required by the database.)
--     begin; set local search_path to qa; \i 0079_down_two_step_signin.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function accessible_group_ids(p_include_read_only boolean default true)
returns uuid[] language sql stable security definer as $$
  with me as (
    select auth.uid() as uid, current_ministry_id() as m
  ), f as (
    select me.uid, me.m,
           exists (select 1 from church_admins c where c.user_id = me.uid) as church_admin,
           exists (select 1 from ministries mi where mi.id = me.m and mi.is_active) as active,
           exists (select 1 from user_roles ur
                   where ur.ministry_id = me.m and ur.user_id = me.uid and ur.role = 'admin') as admin,
           exists (select 1 from user_roles ur
                   where ur.ministry_id = me.m and ur.user_id = me.uid and ur.role = 'general_coordinator') as gc
    from me
  )
  select coalesce(array_agg(g.id), '{}'::uuid[])
  from groups g, f
  where g.ministry_id = f.m
    and (f.church_admin
         or (f.active and (f.admin
             or (g.kind = 'regular' and (f.gc
                 or exists (select 1 from user_roles ur
                            where ur.ministry_id = f.m and ur.user_id = f.uid and ur.group_id = g.id
                              and (p_include_read_only or ur.role <> 'read_only')))))));
$$;

create or replace function has_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce((
    select g.ministry_id = current_ministry_id()
       and (is_admin_in(g.ministry_id, uid)
            or (g.kind = 'regular'
                and (is_admin_or_gc_in(g.ministry_id, uid)
                     or (ministry_is_active(g.ministry_id) and exists (
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
       and exists (select 1 from user_roles ur
                   where ur.user_id = uid and ur.group_id = gid and ur.role = 'read_only')
    from groups g where g.id = gid
  ), false);
$$;

create or replace function is_admin_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (select 1 from user_roles where ministry_id = m and user_id = uid and role = 'admin'))
  );
$$;

create or replace function is_admin_or_gc_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (
      select 1 from user_roles where ministry_id = m and user_id = uid and role in ('admin', 'general_coordinator')))
  );
$$;

create or replace function is_app_user_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (select 1 from user_roles where ministry_id = m and user_id = uid))
  );
$$;

create or replace function is_church_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select exists (select 1 from church_admins where user_id = uid);
$$;

create or replace function is_coordinator_in(m text, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select ministry_exists(m) and (
    is_church_admin(uid)
    or (ministry_is_active(m) and exists (
      select 1 from user_roles where ministry_id = m and user_id = uid
        and role in ('admin', 'general_coordinator', 'sub_coordinator')))
  );
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
             or exists (select 1 from user_roles ur where ur.ministry_id = x.m and ur.user_id = x.uid and ur.role = 'admin')
             or (g.kind = 'regular' and exists (
                   select 1 from user_roles ur
                   where ur.ministry_id = x.m and ur.user_id = x.uid
                     and (ur.role = 'general_coordinator' or ur.group_id = g.id)))))
    else false
  end
  from x;
$$;

do $$
declare
  s text := current_schema();
  f text;
begin
  foreach f in array array[
    'is_church_admin(uuid)', 'is_admin_in(text, uuid)', 'is_admin_or_gc_in(text, uuid)', 'is_coordinator_in(text, uuid)',
    'is_app_user_in(text, uuid)', 'accessible_group_ids(boolean)', 'has_group_access(uuid, uuid)',
    'has_readonly_or_full_group_access(uuid, uuid)', 'storage_photo_read_allowed(text)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
end
$$;

drop function if exists reset_person_authenticator(uuid);
drop function if exists gate_info();
drop function if exists factor_ok(uuid);
drop function if exists aal2_ok(uuid);
