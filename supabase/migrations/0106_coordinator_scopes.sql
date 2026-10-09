-- 0106_coordinator_scopes.sql -- STEWARDS/COORDINATORS OF A GRADE
-- (owner-approved, 9 Oct 2026). High School: make Irene "Steward of Grade 9
-- Girls" once, instead of once per class under Grade 9 Girls.
--
-- * Ministry Settings: app_settings.coordinator_scope -- Coordinators are
--   assigned to 'group' (each class, the default: SAY and new ministries
--   unchanged), 'grade' (every class at one level) or 'grade_gender' (every
--   class at one level for one gender, e.g. Grade 9 Girls).
-- * coordinator_scopes: one row per grade (or grade + gender) grant. It
--   keeps the person's ordinary per-class Coordinator grants (user_roles,
--   marked with scope_id) in step with the classes there -- a class added
--   to Grade 9 Girls is covered, one archived is dropped -- so every
--   existing access rule keeps working unchanged.
-- * Stewards move up with their classes (owner's answer): a scope follows
--   the level its classes are at now, so after the yearly Group Transition
--   "Grade 9 Girls" becomes "Grade 10 Girls". A graduating grade's grants
--   roll back to the new first level, as they do today (GROUP_LADDER_PLAN
--   D8), and the scope follows them there.
-- * The re-check runs at the END of any change to classes (a deferred
--   trigger on groups), so a Group Transition is never seen half-done.
-- * Granting a scope adopts the person's existing per-class Coordinator
--   grants there; removing it removes all of its classes' grants.
-- * QA only: "Refresh QA from production" also copies the scopes.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0106_coordinator_scopes.sql; commit;
-- Undo with 0106_down_coordinator_scopes.sql. Writes no audit entries
-- (the app logs who granted/removed, as for any role grant).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings add column if not exists coordinator_scope text not null default 'group';
alter table app_settings drop constraint if exists app_settings_coordinator_scope_check;
alter table app_settings add constraint app_settings_coordinator_scope_check
  check (coordinator_scope in ('group', 'grade', 'grade_gender'));

create table if not exists coordinator_scopes (
  id uuid primary key default gen_random_uuid(),
  ministry_id text not null references ministries(id),
  user_id uuid not null,
  -- The level its classes are at now (moves up with them).
  ladder_position integer not null,
  -- Null = every class at that level; else only that gender's.
  gender_label text,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique nulls not distinct (ministry_id, user_id, ladder_position, gender_label)
);
alter table coordinator_scopes enable row level security;
revoke all on coordinator_scopes from anon, authenticated;
grant select on coordinator_scopes to authenticated;
grant all on coordinator_scopes to service_role;
drop policy if exists coordinator_scopes_select on coordinator_scopes;
create policy coordinator_scopes_select on coordinator_scopes for select to authenticated
  using (ministry_id = (select current_ministry_id()) and ((select is_app_user()) or user_id = (select auth.uid())));

alter table user_roles add column if not exists scope_id uuid references coordinator_scopes(id) on delete cascade;
create index if not exists idx_user_roles_scope on user_roles (scope_id) where scope_id is not null;

-- Bring one scope's per-class grants in line with the classes there now.
create or replace function sync_coordinator_scope(p_scope uuid)
returns void language plpgsql security definer as $$
declare s coordinator_scopes; v_pos integer;
begin
  select * into s from coordinator_scopes where id = p_scope;
  if s.id is null then return; end if;
  -- Deactivated, or no longer in the ministry: the scope goes (and its grants).
  if exists (select 1 from profiles p where p.ministry_id = s.ministry_id and p.id = s.user_id and p.deactivated_at is not null)
     or not exists (select 1 from profiles p where p.ministry_id = s.ministry_id and p.id = s.user_id) then
    delete from coordinator_scopes where id = s.id;
    return;
  end if;

  -- Follow the classes: the level most of its classes are at now.
  select g.ladder_position into v_pos
  from user_roles ur join groups g on g.id = ur.group_id
  where ur.scope_id = s.id and g.kind::text = 'regular' and not g.is_archived
  group by g.ladder_position
  order by count(*) desc, g.ladder_position
  limit 1;
  if v_pos is not null and v_pos <> s.ladder_position then
    update coordinator_scopes set ladder_position = v_pos where id = s.id;
    s.ladder_position := v_pos;
  end if;

  -- Adopt their existing grants there, add the missing ones, drop the rest.
  update user_roles ur set scope_id = s.id
  from groups g
  where g.id = ur.group_id and ur.ministry_id = s.ministry_id and ur.user_id = s.user_id
    and ur.role = 'sub_coordinator' and ur.scope_id is null
    and g.kind::text = 'regular' and not g.is_archived and g.ladder_position = s.ladder_position
    and (s.gender_label is null or g.gender_label = s.gender_label);

  insert into user_roles (ministry_id, user_id, role, group_id, scope_id)
  select s.ministry_id, s.user_id, 'sub_coordinator', g.id, s.id
  from groups g
  where g.ministry_id = s.ministry_id and g.kind::text = 'regular' and not g.is_archived
    and g.ladder_position = s.ladder_position
    and (s.gender_label is null or g.gender_label = s.gender_label)
  on conflict do nothing;

  delete from user_roles ur
  where ur.scope_id = s.id
    and not exists (select 1 from groups g
                    where g.id = ur.group_id and g.kind::text = 'regular' and not g.is_archived
                      and g.ladder_position = s.ladder_position
                      and (s.gender_label is null or g.gender_label = s.gender_label));
end
$$;

-- After any change to classes (at the end of the transaction).
create or replace function sync_coordinator_scopes_on_group()
returns trigger language plpgsql security definer as $$
begin
  perform sync_coordinator_scope(s.id) from coordinator_scopes s where s.ministry_id = new.ministry_id;
  return null;
end
$$;

drop trigger if exists trg_sync_coordinator_scopes on groups;
create constraint trigger trg_sync_coordinator_scopes
  after insert or update of ladder_position, gender_label, is_archived, kind on groups
  deferrable initially deferred
  for each row execute function sync_coordinator_scopes_on_group();

-- Grant: General Coordinators / Admins. p_gender only for 'grade_gender'.
create or replace function grant_coordinator_scope(p_user_id uuid, p_ladder_position integer, p_gender text)
returns uuid language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_mode text;
  v_gender text := nullif(btrim(coalesce(p_gender, '')), '');
  v_id uuid;
begin
  if not coalesce(is_admin_or_gc_in(v_m), false) then
    raise exception 'Only General Coordinators/Admins can make someone a Coordinator';
  end if;
  select coordinator_scope into v_mode from app_settings where ministry_id = v_m;
  if v_mode = 'group' then
    raise exception 'This ministry assigns Coordinators to each group (Ministry Settings)';
  end if;
  if v_mode = 'grade' then v_gender := null; end if;
  if not exists (select 1 from profiles p where p.ministry_id = v_m and p.id = p_user_id and p.deactivated_at is null) then
    raise exception 'Person not found';
  end if;
  if not exists (select 1 from groups g where g.ministry_id = v_m and g.kind::text = 'regular' and not g.is_archived
                   and g.ladder_position = p_ladder_position
                   and (v_gender is null or g.gender_label = v_gender)) then
    raise exception 'No groups there';
  end if;
  if exists (select 1 from coordinator_scopes where ministry_id = v_m and user_id = p_user_id
               and ladder_position = p_ladder_position and gender_label is not distinct from v_gender) then
    raise exception 'This person is already a Coordinator there';
  end if;
  insert into coordinator_scopes (ministry_id, user_id, ladder_position, gender_label, created_by)
  values (v_m, p_user_id, p_ladder_position, v_gender, auth.uid())
  returning id into v_id;
  perform sync_coordinator_scope(v_id);
  return v_id;
end
$$;

-- Remove: General Coordinators / Admins; all of its classes' grants go.
create or replace function revoke_coordinator_scope(p_scope_id uuid)
returns void language plpgsql security definer as $$
declare v_m text := current_ministry_id();
begin
  if not coalesce(is_admin_or_gc_in(v_m), false) then
    raise exception 'Only General Coordinators/Admins can remove a Coordinator';
  end if;
  if not exists (select 1 from coordinator_scopes where id = p_scope_id and ministry_id = v_m) then
    raise exception 'Not found';
  end if;
  delete from coordinator_scopes where id = p_scope_id and ministry_id = v_m;
end
$$;

-- Removing one class's grant that belongs to a scope removes the scope
-- (otherwise the next re-check would just put it back).
create or replace function revoke_role_grant(p_role_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_role app_role; v_user_id uuid; v_group uuid; v_scope uuid;
begin
  select role, user_id, group_id, scope_id into v_role, v_user_id, v_group, v_scope from user_roles where id = p_role_id and ministry_id = v_m;
  if not (is_admin_or_gc_in(v_m)
          or (v_role = 'servant' and coordinates_group(v_m, v_group))) then
    raise exception 'Only General Coordinators/Admins can revoke a role grant (Coordinators: Servants of their own groups only)';
  end if;
  if v_role is null then raise exception 'Role grant not found'; end if;
  if v_role in ('admin', 'general_coordinator') then
    raise exception 'Admin and General Coordinator grants can only be revoked from Access Maintenance';
  end if;
  if v_scope is not null then
    delete from coordinator_scopes where id = v_scope and ministry_id = v_m;
    return;
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
  foreach f in array array['sync_coordinator_scope(uuid)', 'sync_coordinator_scopes_on_group()',
                           'grant_coordinator_scope(uuid, integer, text)', 'revoke_coordinator_scope(uuid)', 'revoke_role_grant(uuid)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['grant_coordinator_scope(uuid, integer, text)', 'revoke_coordinator_scope(uuid)', 'revoke_role_grant(uuid)'] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;

-- QA only: "Refresh QA from production" copies the scopes too (before the
-- role grants that point at them), and clears QA's for those ministries.
do $$
declare
  v_def text;
  c_ins_old constant text := E'''pending_servant_attendance'', ''qr_codes'', ''user_roles'',';
  c_ins_new constant text := E'''pending_servant_attendance'', ''qr_codes'', ''coordinator_scopes'', ''user_roles'',';
  c_del_old constant text := E'''audit_log'',\n    ''user_roles'', ''qr_codes'',';
  c_del_new constant text := E'''audit_log'',\n    ''user_roles'', ''coordinator_scopes'', ''qr_codes'',';
begin
  if current_schema() <> 'qa' then return; end if;
  v_def := pg_get_functiondef('qa.refresh_from_prod(text[], jsonb, boolean)'::regprocedure);
  if position('coordinator_scopes' in v_def) > 0 then return; end if;
  if position(c_ins_old in v_def) = 0 or position(c_del_old in v_def) = 0 then
    raise exception 'refresh_from_prod has changed; patch it by hand';
  end if;
  execute replace(replace(v_def, c_ins_old, c_ins_new), c_del_old, c_del_new);
end
$$;
