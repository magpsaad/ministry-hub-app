-- 0067_down_rls_group_access_performance.sql -- UNDO of 0067.
--     begin; set local search_path to qa; \i 0067_down_rls_group_access_performance.sql; commit;
-- Puts back the row-by-row rules exactly as 0064 created them, then drops
-- accessible_group_ids().

drop policy members_select on members;
create policy members_select on members for select
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin_or_general_coordinator()) or has_readonly_or_full_group_access(group_id)));
drop policy members_insert on members;
create policy members_insert on members for insert
  with check (ministry_id = (select current_ministry_id())
              and ((select is_admin_or_general_coordinator()) or has_group_access(group_id)));
drop policy members_update on members;
create policy members_update on members for update
  using (ministry_id = (select current_ministry_id())
         and ((select is_admin_or_general_coordinator()) or has_group_access(group_id)));

drop policy attendance_select on attendance_records;
create policy attendance_select on attendance_records for select
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or has_readonly_or_full_group_access((select m.group_id from members m where m.id = attendance_records.member_id))))
    or (attendee_type = 'servant' and (select is_app_user()))));
drop policy attendance_insert on attendance_records;
create policy attendance_insert on attendance_records for insert
  with check (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or has_group_access((select m.group_id from members m where m.id = attendance_records.member_id))))
    or (attendee_type = 'servant' and (select is_coordinator()))));
drop policy attendance_delete on attendance_records;
create policy attendance_delete on attendance_records for delete
  using (ministry_id = (select current_ministry_id()) and (
    (attendee_type = 'member' and ((select is_admin_or_general_coordinator())
        or has_group_access((select m.group_id from members m where m.id = attendance_records.member_id))))
    or (attendee_type = 'servant' and (select is_coordinator()))));

drop policy outreach_select on outreach_entries;
create policy outreach_select on outreach_entries for select
  using (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
         or has_readonly_or_full_group_access((select m.group_id from members m where m.id = outreach_entries.member_id))));
drop policy outreach_insert on outreach_entries;
create policy outreach_insert on outreach_entries for insert
  with check (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
              or has_group_access((select m.group_id from members m where m.id = outreach_entries.member_id))));

drop function accessible_group_ids(boolean);
