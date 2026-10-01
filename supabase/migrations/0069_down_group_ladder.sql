-- 0069_down_group_ladder.sql -- UNDO of 0069_group_ladder.sql.
--     begin; set local search_path to qa; \i 0069_down_group_ladder.sql; commit;
-- Puts back the 0064/0066/0067 functions and security rules (their text is
-- copied verbatim from those files), removes the (empty) hand-over groups
-- and the new columns, and restores display order and SAY's name pattern.
-- Refuses if 0070 (the SAY split) is applied, if any transition has run
-- under the new model, or if a hand-over group holds anyone.

do $$
declare
  v_bad text;
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = current_schema() and table_name = 'groups' and column_name = 'kind') then
    raise exception '0069 is not applied';
  end if;
  if exists (select 1 from groups where check_in_code_group_id is not null) then
    raise exception 'Groups share check-in codes (0070 or App Settings) -- undo 0070 / give them their own codes first';
  end if;
  if exists (select 1 from audit_log where action_type = 'GROUP_TRANSITION_RUN'
             and details ->> 'model' in ('group_ladder_0069', 'say_split_0070')) then
    raise exception 'A transition or the SAY split has run under the new model -- this undo no longer applies';
  end if;
  select string_agg(g.name, ', ') into v_bad from groups g
  where g.kind = 'terminal' and exists (select 1 from members m where m.group_id = g.id);
  if v_bad is not null then raise exception 'Hand-over groups still hold people: %', v_bad; end if;
  if exists (select 1 from groups where cohort_year is not null group by ministry_id, cohort_year having count(*) > 1) then
    raise exception 'Two groups now share a cohort year -- the old rule (one group per year) cannot be put back';
  end if;
end
$$;

-- The check-in-code link is checked at commit; check now instead, so the
-- table can be altered below in the same transaction.
set constraints all immediate;

-- 1. Security rules back to 0064/0067 ------------------------------------
drop policy groups_select on groups;
create policy groups_select on groups for select
  using (ministry_id = (select current_ministry_id()) and (
    (ladder_position = 0 and (select is_admin()))
    or (ladder_position > 0 and ((select is_app_user()) or has_group_access(id)))));
drop policy members_select on members;
create policy members_select on members for select
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin_or_general_coordinator()) or group_id = any ((select accessible_group_ids(true))::uuid[])));
drop policy members_insert on members;
create policy members_insert on members for insert
  with check (ministry_id = (select current_ministry_id())
              and ((select is_admin_or_general_coordinator()) or group_id = any ((select accessible_group_ids(false))::uuid[])));
drop policy members_update on members;
create policy members_update on members for update
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin_or_general_coordinator()) or group_id = any ((select accessible_group_ids(false))::uuid[])));
drop policy members_delete on members;
create policy members_delete on members for delete
  using (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()));
drop policy attendance_select on attendance_records;
create policy attendance_select on attendance_records for select
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(true))::uuid[]))))
    or (attendee_type = 'servant' and (select is_app_user()))));
drop policy attendance_insert on attendance_records;
create policy attendance_insert on attendance_records for insert
  with check (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[]))))
    or (attendee_type = 'servant' and (select is_coordinator()))));
drop policy attendance_delete on attendance_records;
create policy attendance_delete on attendance_records for delete
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[]))))
    or (attendee_type = 'servant' and (select is_coordinator()))));
drop policy outreach_select on outreach_entries;
create policy outreach_select on outreach_entries for select
  using (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
         or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(true))::uuid[]))));
drop policy outreach_insert on outreach_entries;
create policy outreach_insert on outreach_entries for insert
  with check (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
              or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[]))));
drop policy qr_codes_write on qr_codes;
create policy qr_codes_write on qr_codes for all
  using (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()))
  with check (ministry_id = (select current_ministry_id()) and (select is_admin_or_general_coordinator()));

-- 2. Functions back to 0064/0066/0067 ------------------------------------
drop trigger trg_user_roles_no_hidden_group on user_roles;
drop function user_roles_no_hidden_group();

create or replace function has_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce((
    select g.ministry_id = current_ministry_id()
       and (is_admin_or_gc_in(g.ministry_id, uid)
            or (ministry_is_active(g.ministry_id) and exists (
                  select 1 from user_roles ur
                  where ur.user_id = uid and ur.group_id = gid and ur.role <> 'read_only')))
    from groups g where g.id = gid
  ), false);
$$;

create or replace function has_readonly_or_full_group_access(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select has_group_access(gid, uid) or coalesce((
    select g.ministry_id = current_ministry_id()
       and ministry_is_active(g.ministry_id)
       and exists (select 1 from user_roles ur
                   where ur.user_id = uid and ur.group_id = gid and ur.role = 'read_only')
    from groups g where g.id = gid
  ), false);
$$;

create or replace function checkin_resolve(p_token uuid)
returns table(r_ministry_id text, r_group_id uuid, r_flow_type qr_flow_type, r_label text)
language plpgsql stable security definer as $$
declare
  v_active boolean;
begin
  select q.ministry_id, q.group_id, q.flow_type, q.label, mi.is_active
    into r_ministry_id, r_group_id, r_flow_type, r_label, v_active
  from qr_codes q
  join ministries mi on mi.id = q.ministry_id
  where q.check_in_token = p_token;
  if r_ministry_id is null then
    raise exception 'Invalid check-in code';
  end if;
  if not v_active then
    raise exception 'This check-in code is no longer active';
  end if;
  return next;
end
$$;

create or replace function checkin_list_members(p_token uuid)
returns table(member_id uuid, full_name text)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  return query
    select m.id, m.full_name from members m
    where m.ministry_id = v_m and m.group_id = v_group_id and m.status = 'active'
    order by m.full_name;
end
$$;

create or replace function checkin_mark_attendance(p_token uuid, p_member_id uuid)
returns table(attendance_recorded boolean, newly_created boolean, missing_phone boolean, missing_email boolean,
              missing_university boolean, missing_program boolean, missing_dob boolean, missing_father_of_confession boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_inserted_id uuid; v_member members%rowtype;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;

  select * into v_member from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member.group_id is distinct from v_group_id then raise exception 'Member does not belong to this group'; end if;

  if not is_service_day(v_m) then
    return query select false, false,
      (v_member.phone is null or trim(v_member.phone) = ''), (v_member.email is null or trim(v_member.email) = ''),
      (v_member.university_id is null), (v_member.program_of_study is null or trim(v_member.program_of_study) = ''),
      (v_member.date_of_birth is null), (v_member.father_of_confession is null or trim(v_member.father_of_confession) = '');
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

create or replace function checkin_fill_missing_member_fields(
  p_token uuid, p_member_id uuid, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null,
  p_date_of_birth date default null, p_father_of_confession text default null)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;

  select group_id into v_member_group from members where id = p_member_id and ministry_id = v_m and status = 'active';
  if v_member_group is distinct from v_group_id then raise exception 'Member does not belong to this group'; end if;
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

create or replace function checkin_find_possible_duplicate_member(
  p_token uuid, p_full_name text, p_phone text, p_email text, p_university_id uuid default null,
  p_program_of_study text default null, p_date_of_birth date default null, p_gender text default null)
returns table(member_id uuid, group_name text, same_group boolean, name_matches boolean, phone_matches boolean,
              email_matches boolean, university_matches boolean, program_matches boolean, dob_matches boolean, gender_matches boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;

  -- Searches ONLY the QR code's ministry (plan §2.5 #12).
  return query
  select m.id, g.name, (m.group_id = v_group_id),
    (lower(trim(m.full_name)) = lower(trim(p_full_name))),
    (m.phone = p_phone),
    (lower(m.email) = lower(p_email)),
    case when p_university_id is null then null when m.university_id is null then false else (m.university_id = p_university_id) end,
    case when p_program_of_study is null or trim(p_program_of_study) = '' then null
         when m.program_of_study is null or trim(m.program_of_study) = '' then false
         else (lower(trim(m.program_of_study)) = lower(trim(p_program_of_study))) end,
    case when p_date_of_birth is null then null when m.date_of_birth is null then false else (m.date_of_birth = p_date_of_birth) end,
    case when p_gender is null or trim(p_gender) = '' then null when m.gender is null then false else (lower(m.gender) = lower(p_gender)) end
  from members m
  join groups g on g.id = m.group_id
  where m.ministry_id = v_m
    and m.status = 'active'
    and (lower(trim(m.full_name)) = lower(trim(p_full_name)) or m.phone = p_phone or lower(m.email) = lower(p_email))
  order by
    (lower(trim(m.full_name)) = lower(trim(p_full_name)))::int desc,
    ((lower(trim(m.full_name)) = lower(trim(p_full_name)))::int + (m.phone = p_phone)::int + (lower(m.email) = lower(p_email))::int) desc,
    (lower(m.email) = lower(p_email))::int desc,
    (m.phone = p_phone)::int desc
  limit 1;
end
$$;

create or replace function checkin_resolve_duplicate_member(
  p_token uuid, p_member_id uuid, p_move_to_scanned_group boolean,
  p_phone text default null, p_update_phone boolean default false,
  p_date_of_birth date default null, p_update_dob boolean default false,
  p_gender text default null, p_update_gender boolean default false,
  p_university_id uuid default null, p_update_university boolean default false,
  p_program_of_study text default null, p_update_program boolean default false,
  p_home_address text default null, p_update_home_address boolean default false,
  p_father_of_confession text default null, p_update_father_of_confession boolean default false)
returns table(attendance_recorded boolean, newly_created boolean)
language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_is_visitor boolean; v_inserted_id uuid;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if v_flow <> 'check_in_and_intake' then raise exception 'This code does not support attendance check-in'; end if;
  -- Only a member of the QR code's own ministry (plan §2.5 #13).
  if not exists (select 1 from members where id = p_member_id and ministry_id = v_m and status = 'active') then
    raise exception 'Member not found';
  end if;
  if p_update_university and p_university_id is not null
     and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  update members set
    phone = case when p_update_phone then p_phone else phone end,
    date_of_birth = case when p_update_dob then p_date_of_birth else date_of_birth end,
    gender = case when p_update_gender then p_gender else gender end,
    university_id = case when p_update_university then p_university_id else university_id end,
    program_of_study = case when p_update_program then p_program_of_study else program_of_study end,
    home_address = case when p_update_home_address then p_home_address else home_address end,
    father_of_confession = case when p_update_father_of_confession then p_father_of_confession else father_of_confession end,
    group_id = case when p_move_to_scanned_group then v_group_id else group_id end
  where id = p_member_id and ministry_id = v_m
  returning is_visitor into v_is_visitor;

  if not is_service_day(v_m) then
    return query select false, false;
    return;
  end if;

  insert into attendance_records (ministry_id, attendee_type, member_id, service_date, is_visitor_at_time)
  values (v_m, 'member', p_member_id, checkin_today(v_m), coalesce(v_is_visitor, false))
  on conflict (member_id, service_date) do nothing
  returning id into v_inserted_id;

  return query select true, (v_inserted_id is not null);
end
$$;

create or replace function checkin_submit_new_member(
  p_token uuid, p_full_name text, p_phone text default null, p_email text default null,
  p_university_id uuid default null, p_program_of_study text default null, p_date_of_birth date default null,
  p_father_of_confession text default null, p_home_address text default null, p_gender text default null,
  p_comments text default null)
returns table(member_id uuid, attendance_recorded boolean)
language plpgsql security definer as $$
#variable_conflict use_column
declare
  v_m text; v_group_id uuid; v_flow qr_flow_type; v_new_member_id uuid; v_recorded boolean := false;
begin
  select r_ministry_id, r_group_id, r_flow_type into v_m, v_group_id, v_flow from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  if p_university_id is not null and not exists (select 1 from universities where id = p_university_id and ministry_id = v_m) then
    raise exception 'Unknown school';
  end if;

  insert into members (ministry_id, group_id, full_name, phone, email, university_id, program_of_study, date_of_birth,
                       father_of_confession, home_address, gender, registration_comments)
  values (v_m, v_group_id, p_full_name, p_phone, p_email, p_university_id, p_program_of_study, p_date_of_birth,
          p_father_of_confession, p_home_address, p_gender, p_comments)
  returning id into v_new_member_id;

  if v_flow = 'check_in_and_intake' and is_service_day(v_m) then
    insert into attendance_records (ministry_id, attendee_type, member_id, service_date)
    values (v_m, 'member', v_new_member_id, checkin_today(v_m))
    on conflict (member_id, service_date) do nothing;
    v_recorded := true;
  end if;

  return query select v_new_member_id, v_recorded;
end
$$;

create or replace function checkin_undo_attendance(p_token uuid, p_member_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text; v_group_id uuid; v_member_group uuid;
begin
  select r_ministry_id, r_group_id into v_m, v_group_id from checkin_resolve(p_token);
  if v_group_id is null then raise exception 'Invalid check-in code'; end if;
  select group_id into v_member_group from members where id = p_member_id and ministry_id = v_m;
  if v_member_group is distinct from v_group_id then raise exception 'Member does not belong to this group'; end if;

  delete from attendance_records
  where ministry_id = v_m and member_id = p_member_id and attendee_type = 'member'
    and service_date = checkin_today(v_m) and created_at > now() - interval '2 minutes';
end
$$;

create or replace function add_group_tier(p_cohort_year integer default null, p_name text default null, p_qr_color text default '#999999')
returns uuid language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_terminal_position smallint; v_insert_position smallint; v_terminal_id uuid; v_new_id uuid; v_name text;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may add a group'; end if;
  v_name := nullif(trim(p_name), '');
  if v_name is null then raise exception 'Name is required'; end if;

  select max(ladder_position) into v_terminal_position from groups where ministry_id = v_m and not is_archived;
  if v_terminal_position is null then
    raise exception 'No groups exist yet -- the pre-entry group must exist first';
  end if;

  if v_terminal_position = 0 then
    v_insert_position := 1;
  else
    v_insert_position := v_terminal_position;
    select id into v_terminal_id from groups
    where ministry_id = v_m and ladder_position = v_terminal_position and not is_archived limit 1;
    update groups set ladder_position = v_terminal_position + 1 where id = v_terminal_id;
  end if;

  insert into groups (ministry_id, cohort_year, ladder_position, name, display_order, qr_color)
  values (v_m, p_cohort_year, v_insert_position, v_name,
          (select coalesce(max(display_order), 0) + 1 from groups where ministry_id = v_m), p_qr_color)
  returning id into v_new_id;

  insert into qr_codes (ministry_id, group_id, label, image_path) values (v_m, v_new_id, v_name, '');
  return v_new_id;
end
$$;

create or replace function delete_group_tier(p_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_position smallint; v_terminal_position smallint; v_active_members integer; v_role_count integer;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may remove a group'; end if;

  select ladder_position into v_position from groups where id = p_group_id and ministry_id = v_m and not is_archived;
  if v_position is null then raise exception 'Group not found or already archived'; end if;
  if v_position = 0 then raise exception 'The pre-entry group cannot be removed here'; end if;

  select max(ladder_position) into v_terminal_position from groups where ministry_id = v_m and not is_archived;
  if v_position = v_terminal_position then
    raise exception 'The terminal group cannot be removed directly -- merge it via Group Transition instead';
  end if;

  select count(*) into v_active_members from members where ministry_id = v_m and group_id = p_group_id and status = 'active';
  if v_active_members > 0 then
    raise exception 'This group still has % active member(s) -- reassign them to another group first', v_active_members;
  end if;

  select count(*) into v_role_count from user_roles where ministry_id = v_m and group_id = p_group_id;
  if v_role_count > 0 then
    raise exception 'This group still has % servant/coordinator role grant(s) -- reassign them first', v_role_count;
  end if;

  delete from qr_codes where ministry_id = v_m and group_id = p_group_id;
  update groups set is_archived = true where id = p_group_id;
  update groups set ladder_position = ladder_position - 1
  where ministry_id = v_m and ladder_position > v_position and not is_archived;
end
$$;

create or replace function rename_group(p_group_id uuid, p_name text)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may rename a group'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Name cannot be empty'; end if;
  update groups set name = p_name where id = p_group_id and ministry_id = v_m and not is_archived;
  update qr_codes set label = p_name where group_id = p_group_id and ministry_id = v_m;
end
$$;

create or replace function reassign_role_group(p_role_id uuid, p_group_id uuid)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_role app_role;
begin
  if not is_admin_or_gc_in(v_m) then raise exception 'Only General Coordinators/Admins can reassign a role grant'; end if;
  select role into v_role from user_roles where id = p_role_id and ministry_id = v_m;
  if v_role is null then raise exception 'Role grant not found'; end if;
  if v_role <> 'servant' then raise exception 'Only Servant grants can be reassigned to a different group here'; end if;
  if p_group_id is not null and not exists (select 1 from groups where id = p_group_id and ministry_id = v_m) then
    raise exception 'Group not found';
  end if;
  update user_roles set group_id = p_group_id where id = p_role_id and ministry_id = v_m;
end
$$;

create or replace function export_group_member_names(p_group_id uuid)
returns table(full_name text) language plpgsql security definer as $$
begin
  if not is_coordinator() then raise exception 'Only Coordinators/Admins can export a names list'; end if;
  return query
    select m.full_name from members m
    where m.ministry_id = current_ministry_id() and m.group_id = p_group_id and m.status = 'active'
    order by m.full_name;
end
$$;

create or replace function apply_ministry_settings(p_ministry_id text, p_settings jsonb)
returns void language plpgsql security definer as $$
declare
  v jsonb := coalesce(p_settings, '{}'::jsonb) - 'ministry_id' - 'id' - 'updated_at' - 'app_version';
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  update app_settings s set
    (app_title_long, app_title_short, app_subtitle, logo_url, theme_color, theme_color_light, theme_color_dark,
     servants_qr_color, my_assigned_header_color, my_assigned_header_color_light, group_label, member_label,
     group_name_template, same_day_cutoff_time, timezone, service_weekday, youth_attendance_window_weeks,
     servant_attendance_window_weeks, birthday_window_days_before, birthday_window_days_after, university_label,
     program_label, proximity_enabled, show_proximity_on_attendance, actions_needed_lookback_months,
     ladder_position_label, sub_coordinator_auto_servant)
  = (select r.app_title_long, r.app_title_short, r.app_subtitle, r.logo_url, r.theme_color, r.theme_color_light, r.theme_color_dark,
            r.servants_qr_color, r.my_assigned_header_color, r.my_assigned_header_color_light, r.group_label, r.member_label,
            r.group_name_template, r.same_day_cutoff_time, r.timezone, r.service_weekday, r.youth_attendance_window_weeks,
            r.servant_attendance_window_weeks, r.birthday_window_days_before, r.birthday_window_days_after, r.university_label,
            r.program_label, r.proximity_enabled, r.show_proximity_on_attendance, r.actions_needed_lookback_months,
            r.ladder_position_label, r.sub_coordinator_auto_servant
     from jsonb_populate_record(s, v) r)
  where s.ministry_id = p_ministry_id;
  if not found then raise exception 'Ministry % not found', p_ministry_id; end if;
end
$$;

drop function run_group_transition(integer, text, text[], text);
create function run_group_transition(new_pre_entry_cohort_year integer)
returns void language plpgsql security definer as $$
declare
  v_m text := current_ministry_id();
  v_template text;
  v_terminal_position smallint;
  v_new_terminal_position smallint;
  v_old_terminal_group_id uuid;
  v_old_terminal_color text;
  v_new_terminal_group groups%rowtype;
  v_new_yr1_group_id uuid;
  v_new_position0_id uuid;
begin
  if not is_admin_in(v_m) then raise exception 'Only Admins may run a Group Transition'; end if;

  select group_name_template into v_template from app_settings where ministry_id = v_m;

  select max(ladder_position) into v_terminal_position from groups where ministry_id = v_m and not is_archived;
  if v_terminal_position is null or v_terminal_position < 2 then
    raise exception 'Group Transition requires at least one active tier between the pre-entry group and the terminal group -- use Add Group on the App Settings screen first';
  end if;
  v_new_terminal_position := v_terminal_position - 1;

  select id, qr_color into v_old_terminal_group_id, v_old_terminal_color
  from groups where ministry_id = v_m and ladder_position = v_terminal_position and not is_archived limit 1;
  select * into v_new_terminal_group
  from groups where ministry_id = v_m and ladder_position = v_new_terminal_position and not is_archived limit 1;
  select id into v_new_yr1_group_id
  from groups where ministry_id = v_m and ladder_position = 0 and not is_archived limit 1;

  if v_new_terminal_group.id is not null then
    if v_old_terminal_group_id is not null then
      update members set group_id = v_new_terminal_group.id
      where ministry_id = v_m and group_id = v_old_terminal_group_id;
      if v_new_yr1_group_id is not null then
        update user_roles set group_id = v_new_yr1_group_id
        where ministry_id = v_m and group_id = v_old_terminal_group_id;
      end if;
      delete from qr_codes where ministry_id = v_m and group_id = v_old_terminal_group_id;
      update groups set is_archived = true where id = v_old_terminal_group_id;
    end if;

    -- Terminal-cohort naming unchanged (terminal concept parked, plan §16).
    update groups
    set ladder_position = v_terminal_position,
        name = v_new_terminal_group.cohort_year::text || ' and earlier - Yr ' || v_terminal_position::text || '+'
    where id = v_new_terminal_group.id;
  end if;

  update groups set ladder_position = ladder_position + 1
  where ministry_id = v_m and ladder_position < v_new_terminal_position and not is_archived;

  update groups
  set name = replace(replace(v_template, '{cohort_year}', cohort_year::text), '{position_label}', ladder_position::text)
  where ministry_id = v_m and cohort_year is not null and not is_archived and ladder_position < v_terminal_position;

  update qr_codes set label = groups.name
  from groups
  where qr_codes.group_id = groups.id and qr_codes.ministry_id = v_m and not groups.is_archived;

  if v_new_yr1_group_id is not null then
    update qr_codes set flow_type = 'check_in_and_intake' where ministry_id = v_m and group_id = v_new_yr1_group_id;
  end if;

  insert into groups (ministry_id, cohort_year, ladder_position, name, display_order, qr_color)
  values (v_m, new_pre_entry_cohort_year, 0,
          replace(replace(v_template, '{cohort_year}', new_pre_entry_cohort_year::text), '{position_label}', '0'),
          (select coalesce(max(display_order), 0) + 1 from groups where ministry_id = v_m),
          v_old_terminal_color)
  returning id into v_new_position0_id;

  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (v_m, v_new_position0_id, (select name from groups where id = v_new_position0_id), '', 'intake_only');

  insert into audit_log (ministry_id, user_id, action_type, details)
  values (v_m, auth.uid(), 'GROUP_TRANSITION_RUN',
          jsonb_build_object('new_pre_entry_cohort_year', new_pre_entry_cohort_year,
                             'new_terminal_group_id', v_new_terminal_group.id,
                             'archived_old_terminal_group_id', v_old_terminal_group_id));
end
$$;

drop function create_ministry(text, text, text[], text[], text, jsonb, text, text);
create function create_ministry(
  p_id text, p_name text, p_addresses text[], p_admin_emails text[], p_pre_entry_group_name text,
  p_settings jsonb default '{}'::jsonb, p_copy_from text default null)
returns void language plpgsql security definer as $$
declare
  v_email text;
  v_user record;
  v_group_id uuid;
  v_host text;
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  if p_id is null or p_id !~ '^[A-Z]{3}$' then raise exception 'The ministry code must be exactly 3 capital letters'; end if;
  if exists (select 1 from ministries where id = p_id) then raise exception 'The code % is already used', p_id; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Name is required'; end if;
  if nullif(trim(p_pre_entry_group_name), '') is null then raise exception 'A name for the first (pre-entry) group is required'; end if;
  if coalesce(array_length(p_admin_emails, 1), 0) not between 1 and 2 then raise exception 'Give 1 or 2 first Admins'; end if;
  if p_copy_from is not null and not exists (select 1 from ministries where id = p_copy_from) then
    raise exception 'Ministry % to copy from was not found', p_copy_from;
  end if;

  insert into ministries (id, name, display_order)
  values (p_id, trim(p_name), (select coalesce(max(display_order), 0) + 1 from ministries));

  insert into app_settings (ministry_id, app_title_long, app_title_short)
  values (p_id, trim(p_name), trim(p_name));
  perform apply_ministry_settings(p_id, p_settings);

  insert into audit_config (ministry_id, action_type, enabled, description)
  select p_id, t, true,
         (select c.description from audit_config c where c.ministry_id = coalesce(p_copy_from, 'SAY') and c.action_type = t)
  from unnest(enum_range(null::audit_action_type)) t;

  insert into actions_needed_config (ministry_id, proximity, min_presence_count, min_absence_weeks, min_outreach_weeks)
  values (p_id, 'Local', 0, 3, 4), (p_id, 'Regional', 0, 3, 4), (p_id, 'Abroad', 0, 6, 4), (p_id, 'Unknown', 0, 3, 4);

  insert into groups (ministry_id, cohort_year, ladder_position, name, display_order)
  values (p_id, null, 0, trim(p_pre_entry_group_name), 1)
  returning id into v_group_id;
  insert into qr_codes (ministry_id, group_id, label, image_path, flow_type)
  values (p_id, v_group_id, trim(p_pre_entry_group_name), '', 'intake_only');
  insert into qr_codes (ministry_id, group_id, label, image_path)
  values (p_id, null, trim(p_name) || ' Servants', '');

  foreach v_host in array coalesce(p_addresses, '{}') loop
    insert into ministry_addresses (host, ministry_id, kind) values (lower(trim(v_host)), p_id, 'ministry');
  end loop;

  foreach v_email in array p_admin_emails loop
    select u.id, u.email, u.raw_user_meta_data as meta into v_user
    from auth.users u where lower(u.email) = lower(trim(v_email)) limit 1;
    if v_user.id is null then
      raise exception 'No account for % -- ask them to sign in once first', v_email;
    end if;
    insert into profiles (ministry_id, id, full_name, email)
    values (p_id, v_user.id, coalesce(v_user.meta ->> 'full_name', v_user.meta ->> 'name', v_user.email), v_user.email)
    on conflict (ministry_id, id) do nothing;
    insert into user_roles (ministry_id, user_id, role, group_id) values (p_id, v_user.id, 'admin', null)
    on conflict do nothing;
  end loop;

  -- D4: copies, never shared.
  if p_copy_from is not null then
    insert into verses (ministry_id, text, reference, is_active)
    select p_id, text, reference, is_active from verses where ministry_id = p_copy_from;
    insert into holiday_rules (ministry_id, title, basis, start_month, start_day, start_offset, duration_days, is_active, created_by)
    select p_id, title, basis, start_month, start_day, start_offset, duration_days, is_active, null
    from holiday_rules where ministry_id = p_copy_from;
  end if;
end
$$;

drop function get_qr_codes_with_groups();
create function get_qr_codes_with_groups()
returns table(id uuid, label text, check_in_token uuid, updated_at timestamptz,
              group_id uuid, ladder_position integer, qr_color text)
language sql stable security definer as $$
  select q.id, q.label, q.check_in_token, q.updated_at, q.group_id, g.ladder_position::integer, g.qr_color
  from qr_codes q
  left join groups g on g.id = q.group_id
  where q.ministry_id = current_ministry_id() and is_app_user();
$$;

create or replace function accessible_group_ids(p_include_read_only boolean default true)
returns uuid[] language sql stable security definer as $$
  with me as (
    select auth.uid() as uid, current_ministry_id() as m
  ), f as (
    select me.uid, me.m,
           exists (select 1 from church_admins c where c.user_id = me.uid) as church_admin,
           exists (select 1 from ministries mi where mi.id = me.m and mi.is_active) as active,
           exists (select 1 from user_roles ur
                   where ur.ministry_id = me.m and ur.user_id = me.uid
                     and ur.role in ('admin', 'general_coordinator')) as every_group
    from me
  )
  select coalesce(array_agg(g.id), '{}'::uuid[])
  from groups g, f
  where g.ministry_id = f.m
    and (f.church_admin
         or (f.active and (f.every_group
             or exists (select 1 from user_roles ur
                        where ur.ministry_id = f.m and ur.user_id = f.uid and ur.group_id = g.id
                          and (p_include_read_only or ur.role <> 'read_only')))));
$$;

drop function add_group(text, integer, integer, text, text);
drop function move_group(uuid, text);
drop function set_group_level(uuid, integer);
drop function set_group_name_pattern(uuid, text);
drop function set_group_qr_active(uuid, boolean);
drop function set_group_check_in_code(uuid, uuid);
drop function preview_group_transition(integer, text, text[], text);
drop function archive_terminal_members();
drop function group_transition_core(integer, text, text[], text);
drop function checkin_place_member(text, uuid, date);
drop function checkin_served_groups(text, uuid);
drop function transfer_check_in_code(uuid, uuid);
drop function normalize_group_levels(text);
drop function tidy_group_order(text, uuid);
drop function assert_group_name_free(text, text, uuid);
drop function pick_group_color(text);
drop function render_group_name(text, integer, integer, integer, text);

-- 3. Data: remove the (empty) hand-over groups, restore order and pattern --
delete from qr_codes where group_id in (select id from groups where kind = 'terminal');
delete from groups where kind = 'terminal';
do $$
begin
  execute format('update groups g set display_order = b.display_order from %I.ladder_0069_groups b where b.id = g.id',
                 current_schema() || '_premm_backup');
  execute format('update app_settings s set group_name_template = b.group_name_template
                  from %I.ladder_0069_settings b where b.ministry_id = s.ministry_id',
                 current_schema() || '_premm_backup');
end
$$;

-- 4. Columns, constraints, indexes ----------------------------------------
drop index idx_groups_check_in_code;
drop index idx_groups_ministry_kind_level;
drop index uq_groups_one_pre_entry;
drop index idx_groups_ministry_cohort_year;
alter table groups
  drop constraint groups_check_in_code_fkey,
  drop constraint groups_check_in_code_not_self,
  drop constraint groups_regular_qr_active_check,
  drop constraint groups_kind_level_check,
  drop column check_in_code_group_id,
  drop column qr_active,
  drop column name_pattern,
  drop column kind;
drop type group_kind;
alter table groups add constraint groups_ministry_cohort_year_key unique (ministry_id, cohort_year);
create index idx_groups_ladder_position on groups (ladder_position) where not is_archived;
create index idx_groups_ministry_position on groups (ministry_id, ladder_position) where not is_archived;
alter table app_settings drop column level_number_offset, drop column terminal_name_pattern;

-- 5. Privileges and pinned search_path ------------------------------------
do $$
declare
  f record;
  v_schema text := current_schema();
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, p.proconfig
    from pg_proc p where p.pronamespace = v_schema::regnamespace
  loop
    if f.proname in ('run_group_transition', 'create_ministry', 'get_qr_codes_with_groups') then
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
    if f.proconfig is null then
      execute format('alter function %s set search_path = %I, public, pg_temp', f.sig, v_schema);
    end if;
  end loop;
end
$$;

do $$
declare
  v_bad text;
begin
  select string_agg(p.tablename || '.' || p.policyname, ', ') into v_bad
  from pg_policies p
  where p.schemaname = current_schema() and p.tablename not in ('app_releases')
    and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%current_ministry_id()%';
  if v_bad is not null then raise exception 'Rules without the ministry condition: %', v_bad; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.prosecdef and p.proconfig is null;
  if v_bad is not null then raise exception 'Definer functions without a pinned search_path: %', v_bad; end if;
end
$$;

notify pgrst, 'reload schema';
