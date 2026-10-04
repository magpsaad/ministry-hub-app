-- 0077_down_deactivated_people.sql -- undoes 0077 (no Deactivated status; anyone
-- deactivated simply stays without roles).
--     begin; set local search_path to qa; \i 0077_down_deactivated_people.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists set_person_deactivated(uuid, boolean);
drop trigger if exists trg_user_roles_no_deactivated on user_roles;
drop function if exists user_roles_no_deactivated();
drop trigger if exists trg_profiles_guard_deactivation on profiles;
drop function if exists profiles_guard_deactivation();
alter table profiles drop column if exists deactivated_by;
alter table profiles drop column if exists deactivated_at;
