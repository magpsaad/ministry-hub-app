-- 0074_checkin_hardening.sql -- PUBLIC CHECK-IN HARDENING (owner-requested, 3 Oct 2026,
-- after a congregation member's complaint about the check-in page).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0074_checkin_hardening.sql; commit;
-- Undo with 0074_down_checkin_hardening.sql (restores every function below
-- exactly, from the copy this migration saves first).
--
-- 1. Nothing can be overwritten from the public check-in page. The "Is this
--    you?" step no longer takes a record's internal id: it re-finds the
--    record itself and only when at least two of name, phone, email match
--    (phones compared by digits). It only fills blank fields; any detail
--    that differs, and any request to move class, becomes a dated note in
--    the record's registration comments for servants to act on. The
--    duplicate check answers only found / same class. Filling in missing
--    details needs the youth to have checked in today, during check-in hours.
-- 2. No full list: checkin_list_members / checkin_list_servants are dropped.
--    checkin_search_members / checkin_search_servants return at most 10
--    matches for 3+ letters, as first name + last initial ("Mina H."; the
--    full last name only when two results would look the same).
-- 3. Check-in hours: app_settings.checkin_opens_at / checkin_closes_at (on
--    the service day, ministry time zone; default the whole day).
--    Searching, checking in and undoing only work then; registrations are
--    accepted any time but only record attendance then.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- 0. A copy of every function this migration changes or drops, for the undo.
do $$
declare b text := current_schema() || '_premm_backup';
begin
  execute format('create table if not exists %I.fn_backup_0074 (sig text primary key, def text not null, acl text)', b);
  execute format($q$insert into %I.fn_backup_0074 (sig, def, acl)
    select p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proacl::text
    from pg_proc p
    where p.pronamespace = current_schema()::regnamespace
      and p.proname in ('checkin_list_members', 'checkin_list_servants', 'checkin_find_possible_duplicate_member',
                        'checkin_resolve_duplicate_member', 'checkin_fill_missing_member_fields', 'checkin_mark_attendance',
                        'checkin_mark_servant_attendance', 'checkin_mark_pending_servant_attendance',
                        'checkin_submit_new_member', 'checkin_submit_new_servant')
    on conflict (sig) do nothing$q$, b);
end
$$;

-- 3. Check-in hours ----------------------------------------------------------
alter table app_settings add column if not exists checkin_opens_at time not null default '00:00';
alter table app_settings add column if not exists checkin_closes_at time not null default '23:59:59';

create or replace function checkin_is_open(p_ministry_id text)
returns boolean language sql stable security definer as $$
  select coalesce((
    select extract(isodow from (now() at time zone s.timezone))::int = s.service_weekday
       and (now() at time zone s.timezone)::time between s.checkin_opens_at and s.checkin_closes_at
    from app_settings s where s.ministry_id = p_ministry_id and s.timezone is not null and s.service_weekday is not null
  ), false);
$$;

-- What the page shows when check-in is closed.
create or replace function checkin_window(p_token uuid)
returns table(is_open boolean, service_weekday smallint, opens_at time, closes_at time)
language plpgsql stable security definer as $$
declare v_m text;
begin
  select r_ministry_id into v_m from checkin_resolve(p_token);
  return query select checkin_is_open(v_m), s.service_weekday::smallint, s.checkin_opens_at, s.checkin_closes_at
               from app_settings s where s.ministry_id = v_m;
end
$$;

-- 2. Names: search only, shortened -------------------------------------------
create or replace function checkin_short_name(p_full_name text, p_long boolean default false)
returns text language sql immutable as $$
  with w as (select regexp_split_to_array(btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), ' ') a)
  select case when array_length(a, 1) is null or array_length(a, 1) < 2 then coalesce(a[1], '')
              when p_long then a[1] || ' ' || a[array_length(a, 1)]
              else a[1] || ' ' || upper(left(a[array_length(a, 1)], 1)) || '.' end
  from w;
$$;

-- Lower-cased, single-spaced, LIKE-escaped search text ('' when under 3 letters).
create or replace function checkin_search_text(p_query text)
returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p_query, ''), '[^[:alpha:]]', '', 'g')) < 3 then ''
              else replace(replace(replace(lower(btrim(regexp_replace(p_query, '\s+', ' ', 'g'))), '\', '\\'), '%', '\%'), '_', '\_')
         end;
$$;

drop function if exists checkin_list_members(uuid);
drop function if exists checkin_list_servants(uuid);

create or replace function checkin_search_members(p_token uuid, p_query text)
returns table(member_id uuid, display_name text)
language plpgsql stable security definer as $$
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_q text := checkin_search_text(p_query);
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  if not checkin_is_open(v_m) then raise exception 'Check-in is closed'; end if;
  if v_q = '' then return; end if;
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
returns table(id uuid, display_name text, kind text)
language plpgsql stable security definer as $$
declare v_m text; v_group_id uuid; v_q text := checkin_search_text(p_query);
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not checkin_is_open(v_m) then raise exception 'Check-in is closed'; end if;
  if v_q = '' then return; end if;
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

-- The device's remembered person (by the id it saved), shortened.
create or replace function checkin_get_member(p_token uuid, p_member_id uuid)
returns text language plpgsql stable security definer as $$
declare v_m text; v_group_id uuid; v_name text;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null or not checkin_is_open(v_m) then return null; end if;
  select m.full_name into v_name from members m
  where m.id = p_member_id and m.ministry_id = v_m and m.status = 'active'
    and m.group_id = any(checkin_served_groups(v_m, v_group_id));
  return case when v_name is null then null else checkin_short_name(v_name) end;
end
$$;

create or replace function checkin_get_servant(p_token uuid, p_id uuid, p_kind text)
returns text language plpgsql stable security definer as $$
declare v_m text; v_group_id uuid; v_name text;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null or not checkin_is_open(v_m) then return null; end if;
  if p_kind = 'pending' then
    select full_name into v_name from pending_servants where id = p_id and ministry_id = v_m and resulting_profile_id is null;
  else
    select full_name into v_name from profiles where id = p_id and ministry_id = v_m;
  end if;
  return case when v_name is null then null else checkin_short_name(v_name) end;
end
$$;

-- 1. Duplicates: re-found, never overwritten -------------------------------
-- The record the details point to: at least two of name, phone (digits),
-- email must match. Internal only.
create or replace function checkin_match_member(p_ministry_id text, p_full_name text, p_phone text, p_email text)
returns uuid language sql stable security definer as $$
  with q as (select lower(btrim(coalesce(p_full_name, ''))) n,
                    right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) ph,
                    lower(btrim(coalesce(p_email, ''))) em),
  scored as (
    select m.id, m.full_name,
      (q.n <> '' and lower(btrim(m.full_name)) = q.n) as name_m,
      (length(q.ph) = 10 and right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), 10) = q.ph) as phone_m,
      (q.em <> '' and lower(btrim(coalesce(m.email, ''))) = q.em) as email_m
    from members m, q
    where m.ministry_id = p_ministry_id and m.status = 'active')
  select id from scored
  where name_m::int + phone_m::int + email_m::int >= 2
  order by name_m::int + phone_m::int + email_m::int desc, name_m desc, full_name
  limit 1;
$$;

drop function if exists checkin_find_possible_duplicate_member(uuid, text, text, text, uuid, text, date, text);
create function checkin_find_possible_duplicate_member(p_token uuid, p_full_name text, p_phone text, p_email text)
returns table(match_found boolean, same_group boolean)
language plpgsql stable security definer as $$
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_id uuid; v_gid uuid;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  v_id := checkin_match_member(v_m, p_full_name, p_phone, p_email);
  if v_id is null then return; end if;
  select group_id into v_gid from members where id = v_id;
  return query select true, v_gid = any(checkin_served_groups(v_m, v_group_id));
end
$$;

drop function if exists checkin_resolve_duplicate_member(uuid, uuid, boolean, text, boolean, date, boolean, text, boolean,
                                                         uuid, boolean, text, boolean, text, boolean, text, boolean);
create function checkin_resolve_duplicate_member(p_token uuid, p_full_name text, p_phone text, p_email text,
                                                 p_university_id uuid default null, p_program_of_study text default null,
                                                 p_date_of_birth date default null, p_father_of_confession text default null,
                                                 p_home_address text default null, p_gender text default null,
                                                 p_move_requested boolean default false)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_id uuid; v_mem members%rowtype;
  v_notes text[] := '{}'; v_uni text; v_inserted uuid;
  v_phone text := nullif(btrim(p_phone), ''); v_email text := nullif(btrim(p_email), '');
  v_prog text := nullif(btrim(p_program_of_study), ''); v_foc text := nullif(btrim(p_father_of_confession), '');
  v_addr text := nullif(btrim(p_home_address), ''); v_gender text := nullif(btrim(p_gender), '');
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  v_id := checkin_match_member(v_m, p_full_name, p_phone, p_email);
  if v_id is null then raise exception 'No matching record'; end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;
  if v_gender is not null and v_gender not in ('Male', 'Female') then v_gender := null; end if;
  select * into v_mem from members where id = v_id;

  -- Details that differ from the record: noted for the servants, never applied.
  if v_phone is not null and coalesce(btrim(v_mem.phone), '') <> ''
     and right(regexp_replace(v_phone, '\D', '', 'g'), 10) <> right(regexp_replace(v_mem.phone, '\D', '', 'g'), 10) then
    v_notes := v_notes || ('phone ' || v_phone);
  end if;
  if v_email is not null and coalesce(btrim(v_mem.email), '') <> '' and lower(v_email) <> lower(btrim(v_mem.email)) then
    v_notes := v_notes || ('email ' || v_email);
  end if;
  if p_date_of_birth is not null and v_mem.date_of_birth is not null and p_date_of_birth <> v_mem.date_of_birth then
    v_notes := v_notes || ('date of birth ' || to_char(p_date_of_birth, 'YYYY-MM-DD'));
  end if;
  if v_gender is not null and v_mem.gender is not null and v_gender <> v_mem.gender then
    v_notes := v_notes || ('gender ' || v_gender);
  end if;
  if p_university_id is not null and v_mem.university_id is not null and p_university_id <> v_mem.university_id then
    select name into v_uni from universities where id = p_university_id;
    v_notes := v_notes || ('school ' || v_uni);
  end if;
  if v_prog is not null and coalesce(btrim(v_mem.program_of_study), '') <> '' and lower(v_prog) <> lower(btrim(v_mem.program_of_study)) then
    v_notes := v_notes || ('field of focus ' || v_prog);
  end if;
  if v_addr is not null and coalesce(btrim(v_mem.home_address), '') <> '' and lower(v_addr) <> lower(btrim(v_mem.home_address)) then
    v_notes := v_notes || ('address ' || v_addr);
  end if;
  if v_foc is not null and coalesce(btrim(v_mem.father_of_confession), '') <> ''
     and lower(v_foc) <> lower(btrim(v_mem.father_of_confession)) then
    v_notes := v_notes || ('Father of Confession ' || v_foc);
  end if;

  update members set
    phone = coalesce(nullif(btrim(phone), ''), v_phone),
    email = coalesce(nullif(btrim(email), ''), v_email),
    date_of_birth = coalesce(date_of_birth, p_date_of_birth),
    gender = coalesce(gender, v_gender),
    university_id = coalesce(university_id, p_university_id),
    program_of_study = coalesce(nullif(btrim(program_of_study), ''), v_prog),
    home_address = coalesce(nullif(btrim(home_address), ''), v_addr),
    father_of_confession = coalesce(nullif(btrim(father_of_confession), ''), v_foc),
    registration_comments = case
      when cardinality(v_notes) = 0 and not (p_move_requested and not (group_id = any(checkin_served_groups(v_m, v_group_id))))
        then registration_comments
      else left(concat_ws(E'\n', nullif(btrim(registration_comments), ''),
             '[' || to_char(checkin_today(v_m), 'YYYY-MM-DD') || ', self check-in] '
             || concat_ws('; ',
                  case when cardinality(v_notes) > 0 then 'Gave different details: ' || array_to_string(v_notes, ', ') end,
                  case when p_move_requested and not (group_id = any(checkin_served_groups(v_m, v_group_id)))
                       then 'Asked to move to ' || (select name from groups where id = v_group_id) end)
             || ' -- please review.'), 4000)
    end
  where id = v_id;

  if not checkin_is_open(v_m) then
    return query select false, false;
    return;
  end if;
  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', v_id, checkin_today(v_m), coalesce(v_mem.is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted;
  return query select true, (v_inserted is not null);
end
$$;

-- Filling blanks: only for someone who checked in today, during check-in hours.
create or replace function checkin_fill_missing_member_fields(p_token uuid, p_member_id uuid, p_phone text default null,
  p_email text default null, p_university_id uuid default null, p_program_of_study text default null,
  p_date_of_birth date default null, p_father_of_confession text default null)
returns void language plpgsql security definer as $$
declare v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if not checkin_is_open(v_m) then raise exception 'Check-in is closed'; end if;
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

-- Checking in: only during check-in hours (and no field details outside them).
create or replace function checkin_mark_attendance(p_token uuid, p_member_id uuid)
returns table(attendance_recorded boolean, newly_created boolean, missing_phone boolean, missing_email boolean,
              missing_university boolean, missing_program boolean, missing_dob boolean, missing_father_of_confession boolean)
language plpgsql security definer as $$
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_inserted_id uuid; v_member members%rowtype;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  select * into v_member from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member.id is null or not (v_member.group_id = any(checkin_served_groups(v_m, v_group_id))) then
    raise exception 'Member does not belong to this group';
  end if;
  if not checkin_is_open(v_m) then
    return query select false, false, false, false, false, false, false, false;
    return;
  end if;
  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', p_member_id, checkin_today(v_m), coalesce(v_member.is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted_id;
  return query select true, (v_inserted_id is not null),
    (v_member.phone is null or trim(v_member.phone) = ''), (v_member.email is null or trim(v_member.email) = ''),
    (v_member.university_id is null), (v_member.program_of_study is null or trim(v_member.program_of_study) = ''),
    (v_member.date_of_birth is null), (v_member.father_of_confession is null or trim(v_member.father_of_confession) = '');
end
$$;

create or replace function checkin_mark_servant_attendance(p_token uuid, p_servant_id uuid)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare v_m text; v_group_id uuid; v_inserted_id uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not exists (select 1 from profiles where id = p_servant_id and ministry_id = v_m) then
    raise exception 'Servant not found';
  end if;
  if not checkin_is_open(v_m) then
    return query select false, false;
    return;
  end if;
  insert into attendance_records (ministry_id, attendee_type, servant_id, service_date)
  values (v_m, 'servant', p_servant_id, checkin_today(v_m))
  on conflict (ministry_id, servant_id, service_date) do nothing
  returning id into v_inserted_id;
  return query select true, (v_inserted_id is not null);
end
$$;

create or replace function checkin_mark_pending_servant_attendance(p_token uuid, p_pending_servant_id uuid)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare v_m text; v_group_id uuid; v_inserted_id uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  if not exists (select 1 from pending_servants
                 where id = p_pending_servant_id and ministry_id = v_m and resulting_profile_id is null) then
    raise exception 'Pending servant not found';
  end if;
  if not checkin_is_open(v_m) then
    return query select false, false;
    return;
  end if;
  insert into pending_servant_attendance (ministry_id, pending_servant_id, service_date)
  values (v_m, p_pending_servant_id, checkin_today(v_m))
  on conflict (pending_servant_id, service_date) do nothing
  returning id into v_inserted_id;
  return query select true, (v_inserted_id is not null);
end
$$;

-- Registrations: accepted any time; attendance only during check-in hours.
create or replace function checkin_submit_new_member(p_token uuid, p_full_name text, p_phone text default null,
  p_email text default null, p_university_id uuid default null, p_program_of_study text default null,
  p_date_of_birth date default null, p_father_of_confession text default null, p_home_address text default null,
  p_gender text default null, p_comments text default null)
returns table(member_id uuid, attendance_recorded boolean)
language plpgsql security definer as $$
#variable_conflict use_column
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_new_member_id uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;
  insert into members (ministry_id, group_id, full_name, phone, email, university_id, program_of_study, date_of_birth,
                       father_of_confession, home_address, gender, registration_comments)
  values (v_m, checkin_place_member(v_m, v_group_id, p_date_of_birth), p_full_name, p_phone, p_email, p_university_id,
          p_program_of_study, p_date_of_birth, p_father_of_confession, p_home_address, p_gender, p_comments)
  returning id into v_new_member_id;
  if v_flow = 'check_in_and_intake' and checkin_is_open(v_m) then
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date)
    values (v_m, 'member', v_new_member_id, checkin_today(v_m))
    on conflict (member_id, service_date) do nothing;
    v_recorded := true;
  end if;
  return query select v_new_member_id, v_recorded;
end
$$;

create or replace function checkin_submit_new_servant(p_token uuid, p_full_name text, p_phone text default null,
  p_email text default null, p_father_of_confession text default null, p_gender text default null, p_comments text default null)
returns table(pending_id uuid, attendance_recorded boolean)
language plpgsql security definer as $$
declare v_m text; v_group_id uuid; v_pending_id uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is not null then raise exception 'Invalid check-in code'; end if;
  insert into pending_servants (ministry_id, full_name, phone, email, father_of_confession, gender, registration_comments)
  values (v_m, p_full_name, p_phone, p_email, p_father_of_confession, p_gender, p_comments)
  returning id into v_pending_id;
  if checkin_is_open(v_m) then
    insert into pending_servant_attendance (ministry_id, pending_servant_id, service_date)
    values (v_m, v_pending_id, checkin_today(v_m))
    on conflict (pending_servant_id, service_date) do nothing;
    v_recorded := true;
  end if;
  return query select v_pending_id, v_recorded;
end
$$;

-- Pinning and access: the page's functions for signed-out visitors; the
-- helpers only for the database's own functions.
do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array[
    'checkin_window(uuid)', 'checkin_search_members(uuid, text)', 'checkin_search_servants(uuid, text)',
    'checkin_get_member(uuid, uuid)', 'checkin_get_servant(uuid, uuid, text)',
    'checkin_find_possible_duplicate_member(uuid, text, text, text)',
    'checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean)',
    'checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text)',
    'checkin_mark_attendance(uuid, uuid)', 'checkin_mark_servant_attendance(uuid, uuid)',
    'checkin_mark_pending_servant_attendance(uuid, uuid)',
    'checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text)',
    'checkin_submit_new_servant(uuid, text, text, text, text, text, text)']
  loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
  foreach f in array array['checkin_is_open(text)', 'checkin_short_name(text, boolean)', 'checkin_search_text(text)',
                           'checkin_match_member(text, text, text, text)']
  loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;
