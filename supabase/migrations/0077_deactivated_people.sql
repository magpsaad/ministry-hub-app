-- 0077_deactivated_people.sql -- DEACTIVATED PEOPLE (owner-requested, 3 Oct 2026:
-- servants who no longer serve "should be deactivated or archived ... flagged as
-- 'Deactivated' so that they're not inadvertently granted access", keeping their
-- records "for historical purposes" in case they come back).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0077_deactivated_people.sql; commit;
-- Undo with 0077_down_deactivated_people.sql.
--
-- * profiles.deactivated_at / deactivated_by: set = deactivated in that
--   ministry. Their history (attendance, outreach, assignments, audit) stays.
-- * set_person_deactivated(person, on/off) -- Admins only. Deactivating also
--   removes every role the person holds in this ministry; reactivating gives
--   none back (an Admin grants roles afterwards, as for anyone).
-- * A deactivated person can't be given a role by any path (Access
--   Maintenance, Servant Assignments, an approval at sign-in): a guard on
--   user_roles refuses it until they're reactivated.
-- * Only an Admin may change the flag; a person can't clear their own.
-- Writes no audit entries (the app records the Admin's action, as for any
-- Access Maintenance change).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table profiles add column if not exists deactivated_at timestamptz;
alter table profiles add column if not exists deactivated_by uuid;

-- Only an Admin of that ministry may set or clear the flag (profiles_update
-- also lets people edit their own row, and Coordinators edit servants').
-- A change made directly in the database (no signed-in user) is allowed.
create or replace function profiles_guard_deactivation()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT' and (new.deactivated_at is not null or new.deactivated_by is not null))
     or (tg_op = 'UPDATE' and (new.deactivated_at is distinct from old.deactivated_at
                               or new.deactivated_by is distinct from old.deactivated_by)) then
    if auth.uid() is not null and not is_admin_in(new.ministry_id) then
      raise exception 'Only an Admin can deactivate or reactivate a person';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_profiles_guard_deactivation on profiles;
create trigger trg_profiles_guard_deactivation
  before insert or update on profiles
  for each row execute function profiles_guard_deactivation();

-- No role, by any path, for someone deactivated in that ministry.
create or replace function user_roles_no_deactivated()
returns trigger language plpgsql security definer as $$
begin
  if exists (select 1 from profiles p
             where p.ministry_id = new.ministry_id and p.id = new.user_id and p.deactivated_at is not null) then
    raise exception 'This person is deactivated. Reactivate them in Access Maintenance before giving them a role.';
  end if;
  return new;
end
$$;

drop trigger if exists trg_user_roles_no_deactivated on user_roles;
create trigger trg_user_roles_no_deactivated
  before insert or update on user_roles
  for each row execute function user_roles_no_deactivated();

create or replace function set_person_deactivated(p_profile_id uuid, p_deactivated boolean)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then
    raise exception 'Only Admins can deactivate or reactivate a person';
  end if;
  if p_profile_id = auth.uid() and p_deactivated then
    raise exception 'You can''t deactivate yourself';
  end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = p_profile_id) then
    raise exception 'Person not found';
  end if;

  if p_deactivated then
    delete from user_roles where ministry_id = v_m and user_id = p_profile_id;
    update profiles set deactivated_at = coalesce(deactivated_at, now()),
                        deactivated_by = coalesce(deactivated_by, auth.uid())
    where ministry_id = v_m and id = p_profile_id;
  else
    update profiles set deactivated_at = null, deactivated_by = null
    where ministry_id = v_m and id = p_profile_id;
  end if;
end
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function profiles_guard_deactivation() set search_path = %I, public, pg_temp', s);
  execute format('alter function user_roles_no_deactivated() set search_path = %I, public, pg_temp', s);
  execute format('alter function set_person_deactivated(uuid, boolean) set search_path = %I, public, pg_temp', s);
  execute 'revoke all on function profiles_guard_deactivation() from public, anon, authenticated';
  execute 'revoke all on function user_roles_no_deactivated() from public, anon, authenticated';
  execute 'revoke all on function set_person_deactivated(uuid, boolean) from public, anon';
  execute 'grant execute on function set_person_deactivated(uuid, boolean) to authenticated, service_role';
end
$$;
