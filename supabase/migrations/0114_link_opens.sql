-- 0114_link_opens.sql -- DEVICE SETUP: "x" FOR LINK-ONLY USERS (owner-
-- requested 12 Oct 2026). The app now also notes, once per device, when a
-- signed-in person opens it in the browser from a link rather than from its
-- home screen icon. Audit Logs -> Device setup then shows, in the Home icon
-- column: a check mark once they've ever opened it from the icon (and it
-- stays, whatever they do later); an "x" if they've only been seen using a
-- link; blank if neither has been seen yet.
--
-- * link_opens: first and latest browser (non-icon) open per person.
-- * note_link_open(): records it; true when recorded (false when signed
--   out, so the app tries again after sign-in).
-- * device_setup() gains link_only (seen in the browser, never from the
--   icon). Its other columns are unchanged, so the current screen keeps
--   working until the new one is deployed.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0114_link_opens.sql; commit;
-- Undo with 0114_down_link_opens.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists link_opens (
  ministry_id text not null references ministries(id),
  user_id uuid not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (ministry_id, user_id)
);
alter table link_opens enable row level security;
revoke all on link_opens from anon, authenticated;
grant all on link_opens to service_role;

create or replace function note_link_open()
returns boolean language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or v_m is null or not coalesce(ministry_exists(v_m), false)
     or not exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid) then
    return false;
  end if;
  insert into link_opens (ministry_id, user_id) values (v_m, v_uid)
  on conflict (ministry_id, user_id) do update set last_at = now();
  return true;
end
$$;

drop function if exists device_setup();
create function device_setup()
returns table (user_id uuid, full_name text, home_icon boolean, notifications boolean, face_id boolean, link_only boolean)
language sql stable security definer as $$
  select p.id, p.full_name,
         exists (select 1 from home_icon_opens h where h.ministry_id = p.ministry_id and h.user_id = p.id),
         exists (select 1 from push_subscriptions s where s.ministry_id = p.ministry_id and s.user_id = p.id),
         exists (select 1 from unlock_devices d
                 where d.user_id = p.id
                   and d.rp_id in (select a.host from ministry_addresses a where a.ministry_id = p.ministry_id)),
         exists (select 1 from link_opens l where l.ministry_id = p.ministry_id and l.user_id = p.id)
           and not exists (select 1 from home_icon_opens h where h.ministry_id = p.ministry_id and h.user_id = p.id)
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
  foreach f in array array['note_link_open()', 'device_setup()'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
