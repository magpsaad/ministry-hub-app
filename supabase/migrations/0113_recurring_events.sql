-- 0113_recurring_events.sql -- RECURRING CALENDAR EVENTS (owner-approved
-- 11 Oct 2026). A recurring event is saved as one ordinary event per
-- occurrence (so attendance, QR check-in, the calendar views and Calendar
-- Sync all work unchanged), linked by series_id. Editing or deleting asks
-- "this event only" or "this and all following".
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0113_recurring_events.sql; commit;
-- Undo with 0113_down_recurring_events.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table service_calendar_events add column if not exists series_id uuid;
create index if not exists idx_calendar_series on service_calendar_events (series_id, start_date) where series_id is not null;
grant insert (series_id), update (series_id) on service_calendar_events to authenticated;
