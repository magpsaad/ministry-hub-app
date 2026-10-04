-- 0087_parent_contacts.sql -- PARENTS' CONTACT DETAILS ON A YOUTH'S RECORD
-- (owner-requested 4 Oct 2026, for High School and Sunday School).
-- Run once per environment, QA first, together with the app code:
--     begin; set local search_path to qa; \i 0087_parent_contacts.sql; commit;
-- Undo with 0087_down_parent_contacts.sql.
--
-- * Six optional fields on each youth: Parent 1 name / phone / email and
--   Parent 2 name / phone / email.
-- * A per-ministry switch, Ministry Settings -> "Parents' contact details"
--   (app_settings.show_parent_contacts), OFF for every ministry to start.
--   While it's off the app never shows the fields and the check-in page
--   neither asks for nor saves them.
-- * While it's on they behave like the other optional details:
--     - servants see and edit them on the youth's details (same people as
--       the youth's own phone and email);
--     - the check-in page's New Registration form asks for them;
--     - "Is this you?" fills them only where the record is blank, and notes
--       anything different for the servants to review;
--     - after checking in, a youth is offered to fill whichever are blank.
--   Same checks as the youth's own details (letters-only names, a real
--   phone number, a real email address, sensible lengths).
-- * The servants' edit screen can change these six fields (the 0084 field
--   lock is widened to include them).
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- ---------------------------------------------------------------- fields
alter table members
  add column parent1_name text,
  add column parent1_phone text,
  add column parent1_email text,
  add column parent2_name text,
  add column parent2_phone text,
  add column parent2_email text;

alter table members add constraint members_parent_contacts_length check (
  char_length(coalesce(parent1_name, '')) <= 80 and char_length(coalesce(parent2_name, '')) <= 80
  and char_length(coalesce(parent1_phone, '')) <= 30 and char_length(coalesce(parent2_phone, '')) <= 30
  and char_length(coalesce(parent1_email, '')) <= 254 and char_length(coalesce(parent2_email, '')) <= 254);

alter table app_settings add column show_parent_contacts boolean not null default false;

grant update (parent1_name, parent1_phone, parent1_email, parent2_name, parent2_phone, parent2_email)
  on members to authenticated;

-- --------------------------------------------------------------- helpers
-- Whether this ministry keeps parents' contact details.
create or replace function parent_contacts_on(p_m text)
returns boolean language sql stable security definer as $$
  select coalesce((select show_parent_contacts from app_settings where ministry_id = p_m), false);
$$;

-- The check-in page's checks for the parents' details (same rules as
-- checkin_check_person; every field optional).
create or replace function checkin_check_parents(
  p_parent1_name text, p_parent1_phone text, p_parent1_email text,
  p_parent2_name text, p_parent2_phone text, p_parent2_email text)
returns void language plpgsql stable security definer as $$
declare v_name text; v_phone text; v_email text;
begin
  foreach v_name in array array[p_parent1_name, p_parent2_name] loop
    if nullif(btrim(v_name), '') is not null
       and (length(btrim(v_name)) < 2 or length(btrim(v_name)) > 80
            or btrim(v_name) !~ '^[[:alpha:]][[:alpha:] .,()''’-]*$') then
      raise exception 'Please enter the parent''s name using letters only (2 to 80 characters).' using errcode = '22023';
    end if;
  end loop;
  foreach v_phone in array array[p_parent1_phone, p_parent2_phone] loop
    if nullif(btrim(v_phone), '') is not null
       and (length(v_phone) > 30 or length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15) then
      raise exception 'Please enter a valid phone number for the parent.' using errcode = '22023';
    end if;
  end loop;
  foreach v_email in array array[p_parent1_email, p_parent2_email] loop
    if nullif(btrim(v_email), '') is not null
       and (length(btrim(v_email)) > 254 or btrim(v_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'Please enter a valid email address for the parent.' using errcode = '22023';
    end if;
  end loop;
end
$$;

-- ------------------------------------------------- check-in: new youth
drop function checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text);
create function checkin_submit_new_member(
  p_token uuid, p_full_name text, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null, p_date_of_birth date default null,
  p_father_of_confession text default null, p_home_address text default null, p_gender text default null,
  p_comments text default null,
  p_parent1_name text default null, p_parent1_phone text default null, p_parent1_email text default null,
  p_parent2_name text default null, p_parent2_phone text default null, p_parent2_email text default null)
returns table(member_id uuid, attendance_recorded boolean)
language plpgsql security definer as $function$
#variable_conflict use_column
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_label text; v_new_member_id uuid; v_placed uuid; v_recorded boolean := false;
  v_parents boolean;
begin
  select r_ministry_id, r_group_id, r_flow_type, r_label into v_m, v_group_id, v_flow, v_label from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  perform checkin_check_person(p_full_name, p_phone, p_email, p_home_address, p_program_of_study,
                               p_father_of_confession, p_comments, p_date_of_birth);
  v_parents := parent_contacts_on(v_m);
  if v_parents then
    perform checkin_check_parents(p_parent1_name, p_parent1_phone, p_parent1_email,
                                  p_parent2_name, p_parent2_phone, p_parent2_email);
  end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;
  perform checkin_throttle(v_m, 'signup:' || p_token::text, 25, 60);
  perform checkin_throttle(v_m, 'signup', 50, 60);
  insert into members (ministry_id, group_id, full_name, phone, email, university_id, program_of_study, date_of_birth,
                       father_of_confession, home_address, gender, registration_comments,
                       parent1_name, parent1_phone, parent1_email, parent2_name, parent2_phone, parent2_email)
  values (v_m, checkin_place_member(v_m, v_group_id, p_date_of_birth), btrim(p_full_name), p_phone, p_email, p_university_id,
          p_program_of_study, p_date_of_birth, p_father_of_confession, p_home_address, p_gender, p_comments,
          case when v_parents then nullif(btrim(p_parent1_name), '') end,
          case when v_parents then nullif(btrim(p_parent1_phone), '') end,
          case when v_parents then nullif(btrim(p_parent1_email), '') end,
          case when v_parents then nullif(btrim(p_parent2_name), '') end,
          case when v_parents then nullif(btrim(p_parent2_phone), '') end,
          case when v_parents then nullif(btrim(p_parent2_email), '') end)
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
$function$;

-- --------------------------------------------- check-in: "Is this you?"
drop function checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean);
create function checkin_resolve_duplicate_member(
  p_token uuid, p_full_name text, p_phone text, p_email text,
  p_university_id uuid default null, p_program_of_study text default null, p_date_of_birth date default null,
  p_father_of_confession text default null, p_home_address text default null, p_gender text default null,
  p_move_requested boolean default false,
  p_parent1_name text default null, p_parent1_phone text default null, p_parent1_email text default null,
  p_parent2_name text default null, p_parent2_phone text default null, p_parent2_email text default null)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $function$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_id uuid; v_mem members%rowtype;
  v_notes text[] := '{}'; v_uni text; v_inserted uuid; v_parents boolean;
  v_phone text := nullif(btrim(p_phone), ''); v_email text := nullif(btrim(p_email), '');
  v_prog text := nullif(btrim(p_program_of_study), ''); v_foc text := nullif(btrim(p_father_of_confession), '');
  v_addr text := nullif(btrim(p_home_address), ''); v_gender text := nullif(btrim(p_gender), '');
  v_p1n text := nullif(btrim(p_parent1_name), ''); v_p1p text := nullif(btrim(p_parent1_phone), '');
  v_p1e text := nullif(btrim(p_parent1_email), ''); v_p2n text := nullif(btrim(p_parent2_name), '');
  v_p2p text := nullif(btrim(p_parent2_phone), ''); v_p2e text := nullif(btrim(p_parent2_email), '');
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  perform checkin_check_person(p_full_name, p_phone, p_email, p_home_address, p_program_of_study, p_father_of_confession, null, p_date_of_birth);
  v_parents := parent_contacts_on(v_m);
  if v_parents then
    perform checkin_check_parents(p_parent1_name, p_parent1_phone, p_parent1_email,
                                  p_parent2_name, p_parent2_phone, p_parent2_email);
  else
    v_p1n := null; v_p1p := null; v_p1e := null; v_p2n := null; v_p2p := null; v_p2e := null;
  end if;
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
  if v_p1n is not null and coalesce(btrim(v_mem.parent1_name), '') <> '' and lower(v_p1n) <> lower(btrim(v_mem.parent1_name)) then
    v_notes := v_notes || ('parent 1 name ' || v_p1n);
  end if;
  if v_p1p is not null and coalesce(btrim(v_mem.parent1_phone), '') <> ''
     and right(regexp_replace(v_p1p, '\D', '', 'g'), 10) <> right(regexp_replace(v_mem.parent1_phone, '\D', '', 'g'), 10) then
    v_notes := v_notes || ('parent 1 phone ' || v_p1p);
  end if;
  if v_p1e is not null and coalesce(btrim(v_mem.parent1_email), '') <> '' and lower(v_p1e) <> lower(btrim(v_mem.parent1_email)) then
    v_notes := v_notes || ('parent 1 email ' || v_p1e);
  end if;
  if v_p2n is not null and coalesce(btrim(v_mem.parent2_name), '') <> '' and lower(v_p2n) <> lower(btrim(v_mem.parent2_name)) then
    v_notes := v_notes || ('parent 2 name ' || v_p2n);
  end if;
  if v_p2p is not null and coalesce(btrim(v_mem.parent2_phone), '') <> ''
     and right(regexp_replace(v_p2p, '\D', '', 'g'), 10) <> right(regexp_replace(v_mem.parent2_phone, '\D', '', 'g'), 10) then
    v_notes := v_notes || ('parent 2 phone ' || v_p2p);
  end if;
  if v_p2e is not null and coalesce(btrim(v_mem.parent2_email), '') <> '' and lower(v_p2e) <> lower(btrim(v_mem.parent2_email)) then
    v_notes := v_notes || ('parent 2 email ' || v_p2e);
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
    parent1_name = coalesce(nullif(btrim(parent1_name), ''), v_p1n),
    parent1_phone = coalesce(nullif(btrim(parent1_phone), ''), v_p1p),
    parent1_email = coalesce(nullif(btrim(parent1_email), ''), v_p1e),
    parent2_name = coalesce(nullif(btrim(parent2_name), ''), v_p2n),
    parent2_phone = coalesce(nullif(btrim(parent2_phone), ''), v_p2p),
    parent2_email = coalesce(nullif(btrim(parent2_email), ''), v_p2e),
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
$function$;

-- ------------------------------------- check-in: which details are blank
drop function checkin_mark_attendance(uuid, uuid);
create function checkin_mark_attendance(p_token uuid, p_member_id uuid)
returns table(attendance_recorded boolean, newly_created boolean, missing_phone boolean, missing_email boolean,
              missing_university boolean, missing_program boolean, missing_dob boolean, missing_father_of_confession boolean,
              missing_parent1_name boolean, missing_parent1_phone boolean, missing_parent1_email boolean,
              missing_parent2_name boolean, missing_parent2_phone boolean, missing_parent2_email boolean)
language plpgsql security definer as $function$
declare v_m text; v_group_id uuid; v_flow qr_flow_type; v_inserted_id uuid; v_member members%rowtype; v_parents boolean;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  select * into v_member from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member.id is null or not (v_member.group_id = any(checkin_served_groups(v_m, v_group_id))) then
    raise exception 'Member does not belong to this group';
  end if;
  if not checkin_is_open(v_m) then
    return query select false, false, false, false, false, false, false, false, false, false, false, false, false, false;
    return;
  end if;
  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', p_member_id, checkin_today(v_m), coalesce(v_member.is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted_id;
  v_parents := parent_contacts_on(v_m);
  return query select true, (v_inserted_id is not null),
    (v_member.phone is null or trim(v_member.phone) = ''), (v_member.email is null or trim(v_member.email) = ''),
    (v_member.university_id is null), (v_member.program_of_study is null or trim(v_member.program_of_study) = ''),
    (v_member.date_of_birth is null), (v_member.father_of_confession is null or trim(v_member.father_of_confession) = ''),
    (v_parents and coalesce(trim(v_member.parent1_name), '') = ''),
    (v_parents and coalesce(trim(v_member.parent1_phone), '') = ''),
    (v_parents and coalesce(trim(v_member.parent1_email), '') = ''),
    (v_parents and coalesce(trim(v_member.parent2_name), '') = ''),
    (v_parents and coalesce(trim(v_member.parent2_phone), '') = ''),
    (v_parents and coalesce(trim(v_member.parent2_email), '') = '');
end
$function$;

-- ------------------------------------- check-in: fill in blank details
drop function checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text);
create function checkin_fill_missing_member_fields(
  p_token uuid, p_member_id uuid, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null, p_date_of_birth date default null,
  p_father_of_confession text default null,
  p_parent1_name text default null, p_parent1_phone text default null, p_parent1_email text default null,
  p_parent2_name text default null, p_parent2_phone text default null, p_parent2_email text default null)
returns void language plpgsql security definer as $function$
declare v_m text; v_group_id uuid; v_member_group uuid; v_parents boolean;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if not checkin_is_open(v_m) then raise exception 'Check-in is closed'; end if;
  perform checkin_check_person(null, p_phone, p_email, null, p_program_of_study, p_father_of_confession, null, p_date_of_birth, false);
  v_parents := parent_contacts_on(v_m);
  if v_parents then
    perform checkin_check_parents(p_parent1_name, p_parent1_phone, p_parent1_email,
                                  p_parent2_name, p_parent2_phone, p_parent2_email);
  end if;
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
    father_of_confession = case when father_of_confession is null or trim(father_of_confession) = '' then nullif(trim(p_father_of_confession), '') else father_of_confession end,
    parent1_name = case when v_parents and coalesce(trim(parent1_name), '') = '' then nullif(trim(p_parent1_name), '') else parent1_name end,
    parent1_phone = case when v_parents and coalesce(trim(parent1_phone), '') = '' then nullif(trim(p_parent1_phone), '') else parent1_phone end,
    parent1_email = case when v_parents and coalesce(trim(parent1_email), '') = '' then nullif(trim(p_parent1_email), '') else parent1_email end,
    parent2_name = case when v_parents and coalesce(trim(parent2_name), '') = '' then nullif(trim(p_parent2_name), '') else parent2_name end,
    parent2_phone = case when v_parents and coalesce(trim(parent2_phone), '') = '' then nullif(trim(p_parent2_phone), '') else parent2_phone end,
    parent2_email = case when v_parents and coalesce(trim(parent2_email), '') = '' then nullif(trim(p_parent2_email), '') else parent2_email end
  where id = p_member_id and ministry_id = v_m;
end
$function$;

-- ------------------------------------------------- settings and rights
do $$
declare f text;
begin
  foreach f in array array[
    'parent_contacts_on(text)',
    'checkin_check_parents(text, text, text, text, text, text)',
    'checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text, text, text, text, text, text, text)',
    'checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean, text, text, text, text, text, text)',
    'checkin_mark_attendance(uuid, uuid)',
    'checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text, text, text, text, text, text, text)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, current_schema());
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  -- The check-in page's own functions, callable as before (each one still
  -- requires the check-in server key, 0080).
  foreach f in array array[
    'checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text, text, text, text, text, text, text)',
    'checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean, text, text, text, text, text, text)',
    'checkin_mark_attendance(uuid, uuid)',
    'checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text, text, text, text, text, text, text)'
  ] loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end
$$;
