-- 0128_my_access.sql -- A PERSON'S ROLES AND CHURCH ADMIN STATUS IN ONE CALL
-- (owner-approved 18 Oct 2026, fewer database trips). Nearly every page
-- asked for the signed-in person's role grants here and, separately,
-- whether they're the Church Admin (~1,000 + ~675 requests a day).
-- my_access() returns both at once. SECURITY INVOKER: the role grants come
-- through user_roles' own security rule exactly as before (this ministry's,
-- the person's own); is_church_admin() is unchanged.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0128_my_access.sql; commit;
-- Undo with 0128_down_my_access.sql (deploy the app that doesn't call it first).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function my_access()
returns jsonb
language sql stable security invoker as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'group_id', r.group_id))
                       from user_roles r
                       where r.ministry_id = current_ministry_id() and r.user_id = auth.uid()), '[]'::jsonb),
    'church_admin', coalesce(is_church_admin(), false));
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function my_access() set search_path = %I, public, pg_temp', s);
  revoke all on function my_access() from public, anon;
  grant execute on function my_access() to authenticated;
end
$$;
