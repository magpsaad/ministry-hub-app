-- 0107_down_calendar_feeds.sql -- undo 0107: every calendar link stops working.
--     begin; set local search_path to qa; \i 0107_down_calendar_feeds.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists calendar_feed(text);
drop function if exists delete_calendar_feed();
drop function if exists new_calendar_feed();
drop function if exists my_calendar_feed();
drop table if exists calendar_feeds;
