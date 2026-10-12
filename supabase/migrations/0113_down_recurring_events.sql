-- 0113_down_recurring_events.sql -- undo 0113. The occurrences stay as
-- separate events; only the link between them is dropped.
--     begin; set local search_path to qa; \i 0113_down_recurring_events.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop index if exists idx_calendar_series;
alter table service_calendar_events drop column if exists series_id;
