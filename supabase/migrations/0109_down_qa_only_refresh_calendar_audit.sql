-- 0109_down_qa_only_refresh_calendar_audit.sql -- QA ONLY: the refresh stops
-- switching off the calendar audit trigger (takes out 0109's two lines).
--     begin; set local search_path to qa; \i 0109_down_qa_only_refresh_calendar_audit.sql; commit;

do $$
declare v_def text;
begin
  if current_schema() <> 'qa' then
    raise exception 'QA only: run with search_path set to qa (got %)', current_schema();
  end if;
  v_def := pg_get_functiondef('qa.refresh_from_prod(text[], jsonb, boolean)'::regprocedure);
  if position('trg_calendar_events_audit' in v_def) = 0 then return; end if;
  execute replace(replace(v_def,
    E'    alter table qa.service_calendar_events disable trigger trg_calendar_events_audit;\n', ''),
    E'    alter table qa.service_calendar_events enable trigger trg_calendar_events_audit;\n', '');
end
$$;
