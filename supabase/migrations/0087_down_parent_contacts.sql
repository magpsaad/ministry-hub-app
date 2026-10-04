-- 0087_down_parent_contacts.sql -- undoes 0087: the check-in functions go back
-- to their 0086 form, and the parents' fields and the Ministry Settings switch
-- are removed. WARNING: removing the fields deletes any parents' details
-- already entered.
--     begin; set local search_path to qa; \i 0087_down_parent_contacts.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text, text, text, text, text, text, text);
drop function checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean, text, text, text, text, text, text);
drop function checkin_mark_attendance(uuid, uuid);
drop function checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text, text, text, text, text, text, text);
drop function checkin_check_parents(text, text, text, text, text, text);
drop function parent_contacts_on(text);

create function checkin_fill_missing_member_fields(p_token uuid, p_member_id uuid, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_university_id uuid DEFAULT NULL::uuid, p_program_of_study text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_father_of_confession text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;

create function checkin_mark_attendance(p_token uuid, p_member_id uuid)
 RETURNS TABLE(attendance_recorded boolean, newly_created boolean, missing_phone boolean, missing_email boolean, missing_university boolean, missing_program boolean, missing_dob boolean, missing_father_of_confession boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;

create function checkin_resolve_duplicate_member(p_token uuid, p_full_name text, p_phone text, p_email text, p_university_id uuid DEFAULT NULL::uuid, p_program_of_study text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_father_of_confession text DEFAULT NULL::text, p_home_address text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_move_requested boolean DEFAULT false)
 RETURNS TABLE(attendance_recorded boolean, newly_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  perform checkin_check_person(p_full_name, p_phone, p_email, p_home_address, p_program_of_study, p_father_of_confession, null, p_date_of_birth);
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
$function$;

create function checkin_submit_new_member(p_token uuid, p_full_name text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_university_id uuid DEFAULT NULL::uuid, p_program_of_study text DEFAULT NULL::text, p_date_of_birth date DEFAULT NULL::date, p_father_of_confession text DEFAULT NULL::text, p_home_address text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_comments text DEFAULT NULL::text)
 RETURNS TABLE(member_id uuid, attendance_recorded boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$;

do $$
declare f text;
begin
  foreach f in array array[
    'checkin_submit_new_member(uuid, text, text, text, uuid, text, date, text, text, text, text)',
    'checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean)',
    'checkin_mark_attendance(uuid, uuid)',
    'checkin_fill_missing_member_fields(uuid, uuid, text, text, uuid, text, date, text)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, current_schema());
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end
$$;

revoke update (parent1_name, parent1_phone, parent1_email, parent2_name, parent2_phone, parent2_email)
  on members from authenticated;
alter table members drop constraint members_parent_contacts_length;
alter table members
  drop column parent1_name, drop column parent1_phone, drop column parent1_email,
  drop column parent2_name, drop column parent2_phone, drop column parent2_email;
alter table app_settings drop column show_parent_contacts;
