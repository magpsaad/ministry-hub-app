-- 0072_pending_servant_grants.sql -- PRE-APPROVALS THAT CARRY CLASS AND ROLE
-- (owner-requested, 1 Oct 2026, for loading HSY's servants from their sheet).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0072_pending_servant_grants.sql; commit;
-- Undo with 0072_down_pending_servant_grants.sql.
--
-- A pre-approved servant (pending_servants, approved, not yet signed in)
-- can now carry the roles to grant at their first sign-in, in
-- intended_grants: [{"role": "general_coordinator"}, {"role":
-- "sub_coordinator", "group_id": "..."}, {"role": "servant", "group_id":
-- "..."}]. link_approved_pending_servant() applies them; a group that no
-- longer exists, is archived or is hidden by then is skipped. Without
-- intended_grants, or if none applies, the person becomes "Servant,
-- Unassigned" exactly as before. The sheet's name replaces a profile name
-- that is only the sign-in email. Only an Admin (or the database owner,
-- for a load) can set intended_grants.
-- Writes no audit entries. pending_servants is small; the column add locks
-- it for a moment only.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table pending_servants add column if not exists intended_grants jsonb;
alter table pending_servants drop constraint if exists pending_servants_intended_grants_check;
alter table pending_servants add constraint pending_servants_intended_grants_check
  check (intended_grants is null or jsonb_typeof(intended_grants) = 'array');

-- Only an Admin may set or change intended_grants (a General Coordinator can
-- update pending_servants, but must not be able to hand out roles this way).
-- A load run directly in the database (no signed-in user) is allowed.
create or replace function pending_servants_guard_intended_grants()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT' and new.intended_grants is not null)
     or (tg_op = 'UPDATE' and new.intended_grants is distinct from old.intended_grants) then
    if auth.uid() is not null and not is_admin_in(new.ministry_id) then
      raise exception 'Only an Admin can set the roles a pre-approved servant receives';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_pending_servants_guard_intended_grants on pending_servants;
create trigger trg_pending_servants_guard_intended_grants
  before insert or update on pending_servants
  for each row execute function pending_servants_guard_intended_grants();

create or replace function link_approved_pending_servant(p_email text)
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_pending record;
  g record;
begin
  if v_uid is null or v_m is null then return; end if;

  select id, full_name, phone, father_of_confession, gender, intended_grants into v_pending
  from pending_servants
  where ministry_id = v_m and approved_at is not null and resulting_profile_id is null
    and (submitted_by_profile_id = v_uid or (p_email is not null and lower(email) = lower(p_email)))
  order by (submitted_by_profile_id = v_uid) desc, submitted_at asc
  limit 1;
  if v_pending.id is null then return; end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = v_uid) then return; end if;

  -- 0072: the roles carried by the pre-approval (only these three kinds;
  -- class roles only on a regular, current group of this ministry).
  if jsonb_typeof(v_pending.intended_grants) = 'array' then
    for g in
      select e ->> 'role' as role, nullif(e ->> 'group_id', '') as group_id
      from jsonb_array_elements(v_pending.intended_grants) e
    loop
      if g.role = 'general_coordinator' then
        insert into user_roles (ministry_id, user_id, role, group_id)
        values (v_m, v_uid, 'general_coordinator', null) on conflict do nothing;
      elsif g.role in ('sub_coordinator', 'servant') and g.group_id is not null and exists (
              select 1 from groups gr where gr.ministry_id = v_m and gr.id::text = g.group_id
                and gr.kind = 'regular' and not gr.is_archived) then
        insert into user_roles (ministry_id, user_id, role, group_id)
        values (v_m, v_uid, g.role::app_role, g.group_id::uuid) on conflict do nothing;
      end if;
    end loop;
  end if;

  -- As before: someone with no role here yet becomes "Servant, Unassigned".
  if not exists (select 1 from user_roles where ministry_id = v_m and user_id = v_uid) then
    insert into user_roles (ministry_id, user_id, role, group_id) values (v_m, v_uid, 'servant', null);
  end if;

  update profiles set
    full_name = case when profiles.full_name is null or profiles.full_name = profiles.email
                       or profiles.full_name = 'Unnamed User'
                     then coalesce(nullif(btrim(v_pending.full_name), ''), profiles.full_name)
                     else profiles.full_name end,
    phone = coalesce(profiles.phone, v_pending.phone),
    father_of_confession = coalesce(profiles.father_of_confession, v_pending.father_of_confession),
    gender = coalesce(profiles.gender, v_pending.gender)
  where ministry_id = v_m and id = v_uid;

  insert into attendance_records (ministry_id, attendee_type, servant_id, service_date)
  select v_m, 'servant', v_uid, psa.service_date
  from pending_servant_attendance psa
  where psa.pending_servant_id = v_pending.id and psa.ministry_id = v_m
  on conflict (ministry_id, servant_id, service_date) do nothing;

  update pending_servants set resulting_profile_id = v_uid where id = v_pending.id;
end
$$;

-- Same pinning and access as 0064/0069/0071.
do $$
begin
  execute format('alter function link_approved_pending_servant(text) set search_path = %I, public, pg_temp', current_schema());
  execute format('alter function pending_servants_guard_intended_grants() set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function pending_servants_guard_intended_grants() from public, anon, authenticated';
end
$$;
