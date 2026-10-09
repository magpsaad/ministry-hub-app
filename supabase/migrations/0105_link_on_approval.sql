-- 0105_link_on_approval.sql -- owner-reported (9 Oct 2026): servants approved
-- in HSY showed no gender, phone or father of confession. Their answers were
-- saved with their registration but only copied onto their profile the next
-- time they opened the app after approval -- and until then they showed as
-- blank (and under "Other" instead of Female/Male).
--
-- * Approving a registration now links it straight away when the person
--   already has a profile in that ministry (they do: registering requires
--   signing in): their answers are copied onto the profile (only where it's
--   blank), their attendance as a pending servant is copied, and the
--   registration is marked linked. Someone who registered without a profile
--   here is still linked on their next sign-in, as before.
-- * The Servant role with no class that approval gives is now added only to
--   someone with NO role in the ministry yet. Before, anyone without a
--   Servant role got it -- so a person an Admin had already made a
--   Coordinator also landed under "Unassigned".
-- * One function, link_pending_servant(), does the linking for both paths.
-- The "You're approved" phone notification (0093) is unchanged: this runs
-- first (trigger names sort "link" before "notify") and doesn't change the
-- row the notification looks at.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0105_link_on_approval.sql; commit;
-- Undo with 0105_down_link_on_approval.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- Link one approved registration to this person's profile. True if linked.
create or replace function link_pending_servant(p_pending uuid, p_user uuid)
returns boolean language plpgsql security definer as $$
declare r pending_servants;
begin
  select * into r from pending_servants where id = p_pending;
  if r.id is null or r.approved_at is null or r.resulting_profile_id is not null or p_user is null then
    return false;
  end if;
  if not exists (select 1 from profiles where ministry_id = r.ministry_id and id = p_user) then
    return false;
  end if;

  if not exists (select 1 from user_roles where ministry_id = r.ministry_id and user_id = p_user) then
    insert into user_roles (ministry_id, user_id, role, group_id) values (r.ministry_id, p_user, 'servant', null);
  end if;

  update profiles set
    phone = coalesce(nullif(btrim(profiles.phone), ''), nullif(btrim(r.phone), '')),
    father_of_confession = coalesce(nullif(btrim(profiles.father_of_confession), ''), nullif(btrim(r.father_of_confession), '')),
    gender = coalesce(nullif(btrim(profiles.gender), ''), nullif(btrim(r.gender), ''))
  where ministry_id = r.ministry_id and id = p_user;

  insert into attendance_records (ministry_id, attendee_type, servant_id, service_date)
  select r.ministry_id, 'servant', p_user, psa.service_date
  from pending_servant_attendance psa
  where psa.pending_servant_id = r.id and psa.ministry_id = r.ministry_id
  on conflict (ministry_id, servant_id, service_date) do nothing;

  update pending_servants set resulting_profile_id = p_user where id = r.id;
  return true;
end
$$;

-- On sign-in (ensure-profile.ts): same as before, through the one function.
create or replace function link_approved_pending_servant(p_email text)
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_email text;
  v_pending uuid;
begin
  if v_uid is null or v_m is null then return; end if;

  -- The caller's own, confirmed sign-in email -- never the argument.
  select u.email into v_email from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;

  select id into v_pending
  from pending_servants
  where ministry_id = v_m and approved_at is not null and resulting_profile_id is null
    and (submitted_by_profile_id = v_uid or (v_email is not null and lower(email) = lower(v_email)))
  order by (submitted_by_profile_id = v_uid) desc, submitted_at asc
  limit 1;
  if v_pending is null then return; end if;
  perform link_pending_servant(v_pending, v_uid);
end
$$;

-- On approval: link straight away (the registrant is whoever submitted it --
-- registration is self-service -- or, for older rows, the confirmed
-- sign-in with the same email).
create or replace function link_on_approval()
returns trigger language plpgsql security definer as $$
declare v_target uuid;
begin
  if old.approved_at is null and new.approved_at is not null and new.resulting_profile_id is null then
    v_target := new.submitted_by_profile_id;
    if v_target is null and nullif(btrim(new.email), '') is not null then
      select u.id into v_target from auth.users u
      where lower(u.email) = lower(btrim(new.email)) and u.email_confirmed_at is not null
      limit 1;
    end if;
    if v_target is not null then
      perform link_pending_servant(new.id, v_target);
    end if;
  end if;
  return null;
end
$$;

drop trigger if exists trg_link_on_approval on pending_servants;
create trigger trg_link_on_approval after update of approved_at on pending_servants
  for each row execute function link_on_approval();

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['link_pending_servant(uuid, uuid)', 'link_approved_pending_servant(text)', 'link_on_approval()'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function link_approved_pending_servant(text) to authenticated, service_role';
end
$$;
