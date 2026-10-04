-- 0080_checkin_limits.sql -- CHECK-IN POSTER PROTECTION (security audit #2;
-- owner-approved 4 Oct 2026). Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0080_checkin_limits.sql; commit;
-- (0080a, the two new audit types, must be run and committed first.)
-- Undo with 0080_down_checkin_limits.sql.
--
-- Owner's decisions: new sign-ups stay open at any time (no service-hours
-- limit), with these protections --
-- * Field checks on everything a poster can write: a name of letters (plus
--   spaces . , ( ) ' -), 2-80 characters; phone 7-15 digits; a real email; address <= 200,
--   field of focus <= 100, Father of Confession <= 80, comments <= 500;
--   a believable date of birth.
-- * Speed limits, counted in the database whichever way a request arrives:
--     every poster request   600 per poster per 10 minutes
--     name searches          300 per poster per 10 minutes
--     new sign-ups            25 per poster per hour, 50 per ministry per hour
--   (busiest real hour so far: 20 sign-ups across the whole ministry).
-- * Every poster sign-up is written to the audit log (CHECKIN_REGISTRATION,
--   no signed-in user; who/which poster in its details). When more than 10
--   arrive within an hour in a ministry, a CHECKIN_SIGNUP_ALERT audit entry
--   and a checkin_alerts row are added (at most one per hour); Admins see it
--   on the Dashboard until one of them marks it reviewed.
-- * Server-only check-in: once checkin_guard holds the SHA-256 fingerprint
--   of the app server's private key (CHECKIN_SERVER_KEY in Vercel), every
--   check-in request must carry that key (x-checkin-key header) -- a script
--   calling the database directly with the public key is refused. Until the
--   fingerprint is stored the lock is off, so this can go in before the app.
-- Writes no audit entries itself (only the sign-ups it records later).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- A copy of every function this changes, for 0080_down.
do $$
declare b text := current_schema() || '_premm_backup';
begin
  execute format('create schema if not exists %I', b);
  execute format('create table if not exists %I.fn_backup_0080 (sig text primary key, def text not null, acl text, volatile char)', b);
  execute format($q$insert into %I.fn_backup_0080 (sig, def, acl, volatile)
    select p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proacl::text, p.provolatile
    from pg_proc p
    where p.pronamespace = current_schema()::regnamespace
      and p.proname in ('checkin_resolve', 'checkin_search_members', 'checkin_search_servants', 'checkin_submit_new_member',
                        'checkin_submit_new_servant', 'checkin_fill_missing_member_fields', 'checkin_resolve_duplicate_member',
                        'checkin_find_possible_duplicate_member', 'checkin_get_member', 'checkin_get_servant', 'checkin_window')
    on conflict (sig) do nothing$q$, b);
end
$$;

-- ---------------------------------------------------------------- tables
create table if not exists checkin_guard (
  id         integer primary key default 1 check (id = 1),
  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),
  set_at     timestamptz not null default now()
);
alter table checkin_guard enable row level security;
revoke all on checkin_guard from anon, authenticated;

create table if not exists checkin_throttle (
  ministry_id  text not null,
  scope        text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (ministry_id, scope, window_start)
);
alter table checkin_throttle enable row level security;
revoke all on checkin_throttle from anon, authenticated;

create table if not exists checkin_alerts (
  id                uuid primary key default gen_random_uuid(),
  ministry_id       text not null references ministries(id),
  created_at        timestamptz not null default now(),
  signups_last_hour integer not null,
  reviewed_at       timestamptz,
  reviewed_by       uuid
);
alter table checkin_alerts enable row level security;
drop policy if exists checkin_alerts_select on checkin_alerts;
create policy checkin_alerts_select on checkin_alerts for select
  using (ministry_id = (select current_ministry_id()) and (select is_admin()));
revoke all on checkin_alerts from anon, authenticated;
grant select on checkin_alerts to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function checkin_require_server()
returns void language plpgsql stable security definer as $$
declare v_hash text; v_given text;
begin
  select key_sha256 into v_hash from checkin_guard where id = 1;
  if v_hash is null then return; end if;  -- lock not switched on yet
  begin
    v_given := nullif(current_setting('request.headers', true), '')::json ->> 'x-checkin-key';
  exception when others then
    v_given := null;
  end;
  if v_given is null or encode(sha256(convert_to(v_given, 'UTF8')), 'hex') <> v_hash then
    raise exception 'Please use the check-in page.' using errcode = '42501';
  end if;
end
$$;

create or replace function checkin_throttle(p_m text, p_scope text, p_limit integer, p_minutes integer)
returns void language plpgsql volatile security definer as $$
declare v_start timestamptz; v_hits integer;
begin
  v_start := date_bin(make_interval(mins => p_minutes), now(), timestamptz '2000-01-01 00:00:00+00');
  insert into checkin_throttle as t (ministry_id, scope, window_start, hits)
  values (p_m, p_scope, v_start, 1)
  on conflict (ministry_id, scope, window_start) do update set hits = t.hits + 1
  returning t.hits into v_hits;
  if random() < 0.01 then
    delete from checkin_throttle where window_start < now() - interval '1 day';
  end if;
  if v_hits > p_limit then
    raise exception 'Too many check-ins right now — please ask a servant.' using errcode = '54000';
  end if;
end
$$;

-- p_name_required = false: fill-in forms where the name isn't sent.
create or replace function checkin_check_person(
  p_full_name text, p_phone text, p_email text, p_home_address text, p_program text,
  p_father text, p_comments text, p_dob date, p_name_required boolean default true)
returns void language plpgsql stable security definer as $$
begin
  if p_name_required or nullif(btrim(p_full_name), '') is not null then
    if p_full_name is null or length(btrim(p_full_name)) < 2 or length(btrim(p_full_name)) > 80
       or btrim(p_full_name) !~ '^[[:alpha:]][[:alpha:] .,()''’-]*$' then
      raise exception 'Please enter your name using letters only (2 to 80 characters).' using errcode = '22023';
    end if;
  end if;
  if nullif(btrim(p_phone), '') is not null
     and (length(p_phone) > 30 or length(regexp_replace(p_phone, '\D', '', 'g')) not between 7 and 15) then
    raise exception 'Please enter a valid phone number.' using errcode = '22023';
  end if;
  if nullif(btrim(p_email), '') is not null
     and (length(btrim(p_email)) > 254 or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Please enter a valid email address.' using errcode = '22023';
  end if;
  if length(coalesce(p_home_address, '')) > 200 then
    raise exception 'Please keep the address under 200 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_program, '')) > 100 then
    raise exception 'Please keep that answer under 100 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_father, '')) > 80 then
    raise exception 'Please keep the Father of Confession under 80 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_comments, '')) > 500 then
    raise exception 'Please keep comments under 500 characters.' using errcode = '22023';
  end if;
  if p_dob is not null and (p_dob < date '1940-01-01' or p_dob > current_date) then
    raise exception 'Please enter a valid date of birth.' using errcode = '22023';
  end if;
end
$$;

create or replace function checkin_record_signup(p_m text, p_kind text, p_id uuid, p_name text, p_group_id uuid, p_poster text)
returns void language plpgsql volatile security definer as $$
declare v_n integer;
begin
  insert into audit_log (ministry_id, user_id, action_type, group_id, details)
  values (p_m, null, 'CHECKIN_REGISTRATION', p_group_id,
          jsonb_build_object('source', 'checkin_poster', 'kind', p_kind, 'id', p_id, 'name', p_name, 'poster', p_poster));
  select count(*) into v_n from audit_log
  where ministry_id = p_m and action_type = 'CHECKIN_REGISTRATION' and occurred_at > now() - interval '1 hour';
  if v_n > 10 and not exists (select 1 from checkin_alerts where ministry_id = p_m and created_at > now() - interval '1 hour') then
    insert into checkin_alerts (ministry_id, signups_last_hour) values (p_m, v_n);
    insert into audit_log (ministry_id, user_id, action_type, details)
    values (p_m, null, 'CHECKIN_SIGNUP_ALERT',
            jsonb_build_object('source', 'checkin_poster', 'signups_last_hour', v_n));
  end if;
end
$$;

create or replace function review_checkin_alert(p_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_admin_in(current_ministry_id()) then
    raise exception 'Only Admins can mark a check-in alert reviewed';
  end if;
  update checkin_alerts set reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_id and ministry_id = current_ministry_id() and reviewed_at is null;
end
$$;

-- --------------------------------------------- the shared poster lookup
-- Every check-in function starts here, so this is where the server-only
-- lock and the overall per-poster speed limit live.
create or replace function checkin_resolve(p_token uuid)
returns table (r_ministry_id text, r_group_id uuid, r_flow_type qr_flow_type, r_label text)
language plpgsql volatile security definer as $$
declare
  v_active boolean;
  v_code_active boolean;
begin
  perform checkin_require_server();
  select q.ministry_id, q.group_id, q.flow_type, q.label, mi.is_active, coalesce(g.qr_active and not g.is_archived, true)
    into r_ministry_id, r_group_id, r_flow_type, r_label, v_active, v_code_active
  from qr_codes q
  join ministries mi on mi.id = q.ministry_id
  left join groups g on g.id = q.group_id
  where q.check_in_token = p_token;
  if r_ministry_id is null then
    raise exception 'Invalid check-in code';
  end if;
  if not v_active then
    raise exception 'This check-in code is no longer active';
  end if;
  if not v_code_active then
    raise exception 'This check-in code isn''t active';
  end if;
  perform checkin_throttle(r_ministry_id, 'poster:' || p_token::text, 600, 10);
  return next;
end
$$;

-- These only read, but now pass through the speed limit (a write), so they
-- can no longer be marked read-only.
alter function checkin_find_possible_duplicate_member(uuid, text, text, text) volatile;
alter function checkin_get_member(uuid, uuid) volatile;
alter function checkin_get_servant(uuid, uuid, text) volatile;
alter function checkin_window(uuid) volatile;

-- ---------------------------------------------------------------- search
create or replace function checkin_search_members(p_token uuid, p_query text)
returns table (member_id uuid, display_name text)
language plpgsql volatile security definer as $$
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_q text := checkin_search_text(p_query);
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  if not checkin_is_open(v_m) then raise exception 'Check-in is closed'; end if;
  if v_q = '' then return; end if;
  perform checkin_throttle(v_m, 'search:' || p_token::text, 300, 10);
  return query
    with hits as (
      select m.id, m.full_name, checkin_short_name(m.full_name) as short
      from members m
      where m.ministry_id = v_m and m.status = 'active' and m.group_id = any(checkin_served_groups(v_m, v_group_id))
        and (lower(m.full_name) like v_q || '%' or lower(m.full_name) like '% ' || v_q || '%')
      order by m.full_name
      limit 10)
    select h.id, case when count(*) over (partition by h.short) > 1 then checkin_short_name(h.full_name, true) else h.short end
    from hits h
    order by 2;
end
$$;

create or replace function checkin_search_servants(p_token uuid, p_query text)
returns table (id uuid, display_name text, kind text)
language plpgsql volatile security definer as $$
declare v_m text; v_group_id uuid; v_q text := checkin_search_text(p_query);
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not checkin_is_open(v_m) then raise exception 'Check-in is closed'; end if;
  if v_q = '' then return; end if;
  perform checkin_throttle(v_m, 'search:' || p_token::text, 300, 10);
  return query
    with people as (
      select p.id as pid, p.full_name as fname, 'servant'::text as pkind from profiles p where p.ministry_id = v_m
      union all
      select ps.id, ps.full_name, 'pending'::text from pending_servants ps
      where ps.ministry_id = v_m and ps.resulting_profile_id is null
    ), hits as (
      select pid, fname, pkind, checkin_short_name(fname) as short from people
      where lower(fname) like v_q || '%' or lower(fname) like '% ' || v_q || '%'
      order by fname
      limit 10)
    select h.pid, case when count(*) over (partition by h.short) > 1 then checkin_short_name(h.fname, true) else h.short end, h.pkind
    from hits h
    order by 2;
end
$$;

-- --------------------------------------------------------------- sign-ups
create or replace function checkin_submit_new_member(
  p_token uuid, p_full_name text, p_phone text default null, p_email text default null, p_university_id uuid default null,
  p_program_of_study text default null, p_date_of_birth date default null, p_father_of_confession text default null,
  p_home_address text default null, p_gender text default null, p_comments text default null)
returns table (member_id uuid, attendance_recorded boolean)
language plpgsql volatile security definer as $$
#variable_conflict use_column
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_label text; v_new_member_id uuid; v_placed uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id, r_flow_type, r_label into v_m, v_group_id, v_flow, v_label from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  perform checkin_check_person(p_full_name, p_phone, p_email, p_home_address, p_program_of_study,
                               p_father_of_confession, p_comments, p_date_of_birth);
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;
  perform checkin_throttle(v_m, 'signup:' || p_token::text, 25, 60);
  perform checkin_throttle(v_m, 'signup', 50, 60);
  insert into members (ministry_id, group_id, full_name, phone, email, university_id, program_of_study, date_of_birth,
                       father_of_confession, home_address, gender, registration_comments)
  values (v_m, checkin_place_member(v_m, v_group_id, p_date_of_birth), btrim(p_full_name), p_phone, p_email, p_university_id,
          p_program_of_study, p_date_of_birth, p_father_of_confession, p_home_address, p_gender, p_comments)
  returning id, group_id into v_new_member_id, v_placed;
  if v_flow = 'check_in_and_intake' and checkin_is_open(v_m) then
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date)
    values (v_m, 'member', v_new_member_id, checkin_today(v_m))
    on conflict (member_id, service_date) do nothing;
    v_recorded := true;
  end if;
  perform checkin_record_signup(v_m, 'youth', v_new_member_id, btrim(p_full_name), v_placed, v_label);
  return query select v_new_member_id, v_recorded;
end
$$;

create or replace function checkin_submit_new_servant(
  p_token uuid, p_full_name text, p_phone text default null, p_email text default null,
  p_father_of_confession text default null, p_gender text default null, p_comments text default null)
returns table (pending_id uuid, attendance_recorded boolean)
language plpgsql volatile security definer as $$
declare v_m text; v_group_id uuid; v_label text; v_pending_id uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id, r_label into v_m, v_group_id, v_label from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  perform checkin_check_person(p_full_name, p_phone, p_email, null, null, p_father_of_confession, p_comments, null);
  perform checkin_throttle(v_m, 'signup:' || p_token::text, 25, 60);
  perform checkin_throttle(v_m, 'signup', 50, 60);
  insert into pending_servants (ministry_id, full_name, phone, email, father_of_confession, gender, registration_comments)
  values (v_m, btrim(p_full_name), p_phone, p_email, p_father_of_confession, p_gender, p_comments)
  returning id into v_pending_id;
  if checkin_is_open(v_m) then
    insert into pending_servant_attendance (ministry_id, pending_servant_id, service_date)
    values (v_m, v_pending_id, checkin_today(v_m))
    on conflict (pending_servant_id, service_date) do nothing;
    v_recorded := true;
  end if;
  perform checkin_record_signup(v_m, 'servant', v_pending_id, btrim(p_full_name), null, v_label);
  return query select v_pending_id, v_recorded;
end
$$;

-- ----------------------------------------------- the other writing forms
create or replace function checkin_fill_missing_member_fields(
  p_token uuid, p_member_id uuid, p_phone text default null, p_email text default null, p_university_id uuid default null,
  p_program_of_study text default null, p_date_of_birth date default null, p_father_of_confession text default null)
returns void language plpgsql volatile security definer as $$
declare v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if not checkin_is_open(v_m) then raise exception 'Check-in is closed'; end if;
  perform checkin_check_person(null, p_phone, p_email, null, p_program_of_study, p_father_of_confession, null, p_date_of_birth, false);
  select group_id into v_member_group from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member_group is null or not (v_member_group = any(checkin_served_groups(v_m, v_group_id))) then
    raise exception 'Member does not belong to this group';
  end if;
  if not exists (select 1 from attendance_records where ministry_id = v_m and attendee_type = 'member'
                 and member_id = p_member_id and service_date = checkin_today(v_m)) then
    raise exception 'Please check in first';
  end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;
  update members set
    phone = case when phone is null or trim(phone) = '' then nullif(trim(p_phone), '') else phone end,
    email = case when email is null or trim(email) = '' then nullif(trim(p_email), '') else email end,
    university_id = coalesce(university_id, p_university_id),
    program_of_study = case when program_of_study is null or trim(program_of_study) = '' then nullif(trim(p_program_of_study), '') else program_of_study end,
    date_of_birth = coalesce(date_of_birth, p_date_of_birth),
    father_of_confession = case when father_of_confession is null or trim(father_of_confession) = '' then nullif(trim(p_father_of_confession), '') else father_of_confession end
  where id = p_member_id and ministry_id = v_m;
end
$$;

do $$
declare s text := current_schema(); f text; r record;
begin
  -- The "is this you?" path writes notes from what was typed: same checks.
  -- Its body is long and otherwise unchanged, so the check is added in place.
  select pg_get_functiondef(p.oid) as def into r
  from pg_proc p where p.pronamespace = s::regnamespace and p.proname = 'checkin_resolve_duplicate_member';
  if position('checkin_check_person' in r.def) = 0 then
    if position('This code does not support attendance check-in''; end if;' in r.def) = 0 then
      raise exception 'checkin_resolve_duplicate_member is not the expected version';
    end if;
    execute replace(r.def,
      'if v_flow <> ''check_in_and_intake'' then raise exception ''This code does not support attendance check-in''; end if;',
      'if v_flow <> ''check_in_and_intake'' then raise exception ''This code does not support attendance check-in''; end if;
  perform checkin_check_person(p_full_name, p_phone, p_email, p_home_address, p_program_of_study, p_father_of_confession, null, p_date_of_birth);');
  end if;

  foreach f in array array[
    'checkin_require_server()', 'checkin_throttle(text, text, integer, integer)',
    'checkin_check_person(text, text, text, text, text, text, text, date, boolean)',
    'checkin_record_signup(text, text, uuid, text, uuid, text)', 'review_checkin_alert(uuid)',
    'checkin_resolve(uuid)', 'checkin_search_members(uuid, text)', 'checkin_search_servants(uuid, text)',
    'checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text)',
    'checkin_submit_new_servant(uuid, text, text, text, text, text, text)',
    'checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;

  -- Internal helpers: never called from outside.
  foreach f in array array[
    'checkin_require_server()', 'checkin_throttle(text, text, integer, integer)',
    'checkin_check_person(text, text, text, text, text, text, text, date, boolean)',
    'checkin_record_signup(text, text, uuid, text, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  execute 'revoke all on function review_checkin_alert(uuid) from public, anon';
  execute 'grant execute on function review_checkin_alert(uuid) to authenticated, service_role';
end
$$;
