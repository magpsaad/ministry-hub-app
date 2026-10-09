-- 0108_down_onboarding_status.sql -- undo 0108 (approved people leave Pending
-- Servants once their registration is linked, as after 0105).
--     begin; set local search_path to qa; \i 0108_down_onboarding_status.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists pending_onboarding();
drop function if exists note_first_visit();
alter table pending_servants drop column if exists first_visit_at;
