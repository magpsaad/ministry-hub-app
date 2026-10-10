-- 0109_qa_only_refresh_calendar_audit.sql -- QA ONLY. Never run with search_path prod.
--     begin; set local search_path to qa; \i 0109_qa_only_refresh_calendar_audit.sql; commit;
--
-- Owner-reported (10 Oct 2026): "Refresh QA from production" for HSY failed
-- with 'update or delete on table "profiles" violates foreign key
-- constraint "audit_log_user_fkey"'. The calendar safety net (0082,
-- trg_calendar_events_audit) writes an audit entry for every calendar event
-- deleted or added -- including the refresh's own delete-and-copy, after
-- the refresh has already cleared that ministry's audit log. Once the
-- person running it had a profile in that ministry (copied by the previous
-- refresh), those entries carried their name and blocked deleting their
-- profile. The refresh now switches that trigger off while it copies, like
-- the three triggers it already switches off.
--
-- Patches the live function (refuses if the expected lines aren't found or
-- it's already patched). Undo: 0109_down_qa_only_refresh_calendar_audit.sql.

do $$
declare
  v_def text;
  c_off_old constant text := E'    alter table qa.user_roles disable trigger trg_ensure_servant_for_sub_coordinator;\n';
  c_off_new constant text := c_off_old || E'    alter table qa.service_calendar_events disable trigger trg_calendar_events_audit;\n';
  c_on_old constant text := E'    alter table qa.user_roles enable trigger trg_ensure_servant_for_sub_coordinator;\n';
  c_on_new constant text := c_on_old || E'    alter table qa.service_calendar_events enable trigger trg_calendar_events_audit;\n';
begin
  if current_schema() <> 'qa' then
    raise exception 'QA only: run with search_path set to qa (got %)', current_schema();
  end if;
  v_def := pg_get_functiondef('qa.refresh_from_prod(text[], jsonb, boolean)'::regprocedure);
  if position('trg_calendar_events_audit' in v_def) > 0 then
    raise exception 'refresh_from_prod already switches off the calendar audit trigger';
  end if;
  if position(c_off_old in v_def) = 0 or position(c_on_old in v_def) = 0 then
    raise exception 'refresh_from_prod has changed; patch it by hand';
  end if;
  execute replace(replace(v_def, c_off_old, c_off_new), c_on_old, c_on_new);
end
$$;
