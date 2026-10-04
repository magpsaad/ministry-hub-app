-- 0078_link_by_verified_email.sql -- APPROVALS MATCH THE SIGNED-IN EMAIL ONLY
-- (security audit 3 Oct 2026, finding #1; owner-approved sign-in fix F).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0078_link_by_verified_email.sql; commit;
-- Undo with 0078_down_link_by_verified_email.sql (restores the 0076 form).
--
-- link_approved_pending_servant(p_email) used to match an approved
-- registration on whatever email the CALLER passed in, so anyone signed in
-- could call it directly with someone else's email and take their approval.
-- It now ignores p_email and uses the email on the caller's own sign-in
-- account, and only once that email has been confirmed (Google sign-ins and
-- emailed codes both confirm it). The parameter stays so the app's existing
-- call keeps working. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function link_approved_pending_servant(p_email text)
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_email text;
  v_pending record;
begin
  if v_uid is null or v_m is null then return; end if;

  -- The caller's own, confirmed sign-in email -- never the argument.
  select u.email into v_email from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;

  select id, phone, father_of_confession, gender into v_pending
  from pending_servants
  where ministry_id = v_m and approved_at is not null and resulting_profile_id is null
    and (submitted_by_profile_id = v_uid or (v_email is not null and lower(email) = lower(v_email)))
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
  execute 'revoke all on function link_approved_pending_servant(text) from public, anon';
  execute 'grant execute on function link_approved_pending_servant(text) to authenticated, service_role';
end
$$;
