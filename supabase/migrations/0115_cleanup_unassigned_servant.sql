-- 0115_cleanup_unassigned_servant.sql -- ONE-TIME: remove the leftover
-- "Unassigned" Servant grants of people who already hold a Servant grant
-- for a group (the ones 0115 now prevents). Removes only the extra grant:
-- no youth assignments change. Someone whose only other role isn't a group
-- Servant grant (e.g. an Admin who is also an unassigned Servant) is left
-- alone. Run after 0115, per environment, with the owner's go-ahead for prod:
--     begin; set local search_path to qa; \i 0115_cleanup_unassigned_servant.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

delete from user_roles u
where u.role = 'servant' and u.group_id is null and u.scope_id is null
  and exists (select 1 from user_roles r
              where r.ministry_id = u.ministry_id and r.user_id = u.user_id
                and r.role = 'servant' and r.group_id is not null);
