-- 0076_remove_pending_servant_grants.sql -- REMOVES THE PRE-APPROVAL-WITH-ROLES FEATURE
-- (owner-requested, 3 Oct 2026: "That will never happen again in the future.
-- Going forward, anyone signing in must go through the proper onboarding
-- process including being approved first then later being assigned a role or
-- a class.")
-- Same effect as 0072_down: pending_servants.intended_grants, its check and
-- its guard trigger are dropped, and link_approved_pending_servant() goes
-- back to its pre-0072 form -- an approved person becomes "Servant,
-- Unassigned" at first sign-in and an Admin/GC assigns class and role later.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0076_remove_pending_servant_grants.sql; commit;
-- Undo with 0076_down_remove_pending_servant_grants.sql (re-applies 0072).
-- Writes no audit entries. pending_servants is small (no waiting rows at
-- the time; none carried roles).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop trigger if exists trg_pending_servants_guard_intended_grants on pending_servants;
drop function if exists pending_servants_guard_intended_grants();
alter table pending_servants drop constraint if exists pending_servants_intended_grants_check;
alter table pending_servants drop column if exists intended_grants;

create or replace function link_approved_pending_servant(p_email text)
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_pending record;
begin
  if v_uid is null or v_m is null then return; end if;

  select id, phone, father_of_confession, gender into v_pending
  from pending_servants
  where ministry_id = v_m and approved_at is not null and resulting_profile_id is null
    and (submitted_by_profile_id = v_uid or (p_email is not null and lower(email) = lower(p_email)))
  order by (submitted_by_profile_id = v_uid) desc, submitted_at asc
  limit 1;
  if v_pending.id is null then return; end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = v_uid) then return; end if;

  if not exists (select 1 from user_roles where ministry_id = v_m and user_id = v_uid and role = 'servant') then
    insert into user_roles (ministry_id, user_id, role, group_id) values (v_m, v_uid, 'servant', null);
  end if;

  update profiles set
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

do $$
begin
  execute format('alter function link_approved_pending_servant(text) set search_path = %I, public, pg_temp', current_schema());
end
$$;
