-- 0091_down_church_timezone.sql -- undoes 0091.
--     begin; set local search_path to qa; \i 0091_down_church_timezone.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_releases alter column released_on set default current_date;
drop function if exists church_timezone();
