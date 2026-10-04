-- 0084_down_locked_fields.sql -- undoes 0084 (signed-in people may again change any
-- field on these tables, subject to the row rules).
--     begin; set local search_path to qa; \i 0084_down_locked_fields.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop trigger if exists trg_guard_person_fields on members;
drop trigger if exists trg_guard_person_fields on profiles;
drop trigger if exists trg_guard_person_fields on service_calendar_events;
drop trigger if exists trg_guard_person_fields on pending_servants;
drop function if exists guard_person_fields();
drop function if exists my_sign_in_email();
alter function update_join_date_on_attendance() security invoker;

grant insert, update on members to authenticated;
grant update on profiles to authenticated;
grant insert, update on service_calendar_events to authenticated;
grant update on outreach_entries to authenticated;
grant update on pending_servants to authenticated;

drop policy if exists outreach_insert on outreach_entries;
create policy outreach_insert on outreach_entries for insert
  with check ((ministry_id = (select current_ministry_id()))
              and ((select is_admin()) or (member_id in (
                    select m.id from members m where m.group_id = any ((select accessible_group_ids(false))::uuid[])))));
