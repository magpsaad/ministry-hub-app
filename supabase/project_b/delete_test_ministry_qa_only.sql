-- delete_test_ministry_qa_only.sql -- QA ONLY (plan §11 phase B7 rollback).
-- Removes a TEST ministry and every row it owns, e.g. after two-ministry
-- testing. Refuses to run outside qa, and refuses to touch SAY.
--     begin; set local search_path to qa;
--     select set_config('mm.delete_ministry', 'TST', true);
--     \i delete_test_ministry_qa_only.sql
--     commit;

do $$
declare
  m text := current_setting('mm.delete_ministry', true);
  t text;
begin
  if current_schema() <> 'qa' then raise exception 'QA only (search_path is %)', current_schema(); end if;
  if m is null or m !~ '^[A-Z]{3}$' then raise exception 'Set mm.delete_ministry to the 3-letter code first'; end if;
  if m = 'SAY' then raise exception 'Refusing to delete SAY'; end if;
  if not exists (select 1 from ministries where id = m) then raise exception 'Ministry % not found', m; end if;

  -- Children before parents.
  foreach t in array array[
    'pending_servant_attendance', 'attendance_records', 'outreach_entries', 'audit_log', 'members', 'qr_codes',
    'user_roles', 'pending_servants', 'service_calendar_events', 'holiday_rules', 'verses', 'universities',
    'audit_config', 'actions_needed_config', 'profiles', 'groups', 'app_settings'
  ] loop
    execute format('delete from %I where ministry_id = %L', t, m);
  end loop;
  delete from ministry_addresses where ministry_id = m;
  delete from ministries where id = m;
end
$$;
