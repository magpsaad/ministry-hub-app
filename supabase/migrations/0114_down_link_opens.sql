-- 0114_down_link_opens.sql -- undo 0114 (back to 0110's device_setup()).
--     begin; set local search_path to qa; \i 0114_down_link_opens.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop function if exists device_setup();
create function device_setup()
returns table (user_id uuid, full_name text, home_icon boolean, notifications boolean, face_id boolean)
language sql stable security definer as $$
  select p.id, p.full_name,
         exists (select 1 from home_icon_opens h where h.ministry_id = p.ministry_id and h.user_id = p.id),
         exists (select 1 from push_subscriptions s where s.ministry_id = p.ministry_id and s.user_id = p.id),
         exists (select 1 from unlock_devices d
                 where d.user_id = p.id
                   and d.rp_id in (select a.host from ministry_addresses a where a.ministry_id = p.ministry_id))
  from profiles p
  where p.ministry_id = current_ministry_id()
    and (is_admin_in(current_ministry_id()) or is_church_admin())
    and p.deactivated_at is null
    and exists (select 1 from user_roles ur where ur.ministry_id = p.ministry_id and ur.user_id = p.id)
  order by p.full_name
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function device_setup() set search_path = %I, public, pg_temp', s);
  revoke all on function device_setup() from public, anon, authenticated;
  grant execute on function device_setup() to authenticated, service_role;
end
$$;

drop function if exists note_link_open();
drop table if exists link_opens;
