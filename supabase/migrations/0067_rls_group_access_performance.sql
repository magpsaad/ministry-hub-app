-- 0067_rls_group_access_performance.sql -- Project B follow-up (QA first).
--     begin; set local search_path to qa; \i 0067_rls_group_access_performance.sql; commit;
--
-- WHY: the per-ministry security rules from 0064 checked group access ROW
-- BY ROW (has_readonly_or_full_group_access() for every attendance, youth
-- and outreach row, plus again inside the youth lookup each attendance row
-- makes). Each call runs a chain of small helper functions, so for anyone
-- who isn't an Admin or General Coordinator a group's attendance history
-- took ~8 s in QA (4,600 rows) and hit the 8 s statement limit ("Something
-- went wrong loading this page").
--
-- WHAT: the same rules, evaluated once per query. accessible_group_ids()
-- returns the groups this person may see (or edit) in the ministry this
-- request is working in, computed once; each rule then only checks whether
-- a row's group is in that list. WHO can see or change WHAT is unchanged --
-- verified role by role against the old rules before this was applied.
-- Undo with 0067_down_rls_group_access_performance.sql.

-- The groups this person can access in the current ministry, in ONE query.
-- p_include_read_only = true: view access (any role at the group, incl.
-- Read-Only); false: edit access (a non-Read-Only role at the group).
-- Admins and General Coordinators of the ministry, and the Church Admin,
-- get every group. Same logic as has_readonly_or_full_group_access() /
-- has_group_access(), flattened.
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

do $$
begin
  execute format('alter function accessible_group_ids(boolean) set search_path = %I, public, pg_temp', current_schema());
end
$$;
revoke all on function accessible_group_ids(boolean) from public, anon, authenticated;
grant execute on function accessible_group_ids(boolean) to anon, authenticated, service_role;

-- Youth (members) -------------------------------------------------------------
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

-- Attendance ----------------------------------------------------------------
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

-- Outreach ------------------------------------------------------------------
drop policy outreach_select on outreach_entries;
create policy outreach_select on outreach_entries for select
  using (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
         or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(true))::uuid[]))));
drop policy outreach_insert on outreach_entries;
create policy outreach_insert on outreach_entries for insert
  with check (ministry_id = (select current_ministry_id()) and ((select is_admin_or_general_coordinator())
              or member_id in (select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[]))));
