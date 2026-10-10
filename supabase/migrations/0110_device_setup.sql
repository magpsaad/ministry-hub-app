-- 0110_device_setup.sql -- AUDIT LOGS -> DEVICE SETUP (owner-approved 10 Oct
-- 2026): for System Admins, everyone in the ministry with a check mark for
-- each of: has opened the app from its home screen icon, has phone
-- notifications on, has Face ID (or fingerprint / device PIN) unlock set up.
--
-- * home_icon_opens: the first (and latest) time each person opened the app
--   from its home screen icon on this ministry's address -- recorded by the
--   app (note_home_icon) from now on; a check mark once there's a row.
-- * Notifications: a phone/computer registered for this ministry
--   (push_subscriptions).
-- * Face ID: an unlock device registered on one of this ministry's web
--   addresses (unlock_devices.rp_id = ministry_addresses.host).
-- * device_setup(): System Admins (and the Church Admin) only; everyone with
--   a role here, not deactivated.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0110_device_setup.sql; commit;
-- Undo with 0110_down_device_setup.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists home_icon_opens (
  ministry_id text not null references ministries(id),
  user_id uuid not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (ministry_id, user_id)
);
alter table home_icon_opens enable row level security;
revoke all on home_icon_opens from anon, authenticated;
grant all on home_icon_opens to service_role;

-- The app, when opened from its home screen icon (once per visit).
create or replace function note_home_icon()
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or v_m is null or not coalesce(ministry_exists(v_m), false)
     or not exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid) then
    return;
  end if;
  insert into home_icon_opens (ministry_id, user_id) values (v_m, v_uid)
  on conflict (ministry_id, user_id) do update set last_at = now();
end
$$;

create or replace function device_setup()
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
declare s text := current_schema(); f text;
begin
  foreach f in array array['note_home_icon()', 'device_setup()'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
