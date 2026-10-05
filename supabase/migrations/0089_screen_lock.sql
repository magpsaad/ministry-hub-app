-- 0089_screen_lock.sql -- SCREEN LOCK AFTER IDLE, UNLOCK WITH FACE ID /
-- FINGERPRINT (owner-approved 5 Oct 2026, after the High School priest's
-- request). Run once per environment, QA first, together with the app code:
--     begin; set local search_path to qa; \i 0089_screen_lock.sql; commit;
-- Undo with 0089_down_screen_lock.sql.
--
-- * Ministry Settings -> Screen Lock (app_settings.idle_lock_minutes): lock
--   the app after 2, 5, 10, 15 or 30 minutes untouched; empty = off (every
--   ministry starts off). Applies to everyone, Admins and GCs included.
--   Nothing else about signing in changes.
-- * session_activity: when each sign-in (one row per Supabase session) was
--   last used. The app reports activity at most every 20 seconds while the
--   person is actually tapping or typing; a sign-in quiet for longer than
--   its ministry's minutes (plus one minute's grace) is locked, and every
--   page and save is refused until it's unlocked. Reporting activity can
--   never unlock a locked sign-in.
-- * Unlocking happens only through this app's server (it proves itself with
--   the check-in server key, as in 0080), after it has checked one of:
--   Face ID / fingerprint / the device's PIN (a WebAuthn passkey), or the
--   person's authenticator code. Signing in again with an email code starts
--   a new, unlocked sign-in.
-- * unlock_devices: each device a person turned Face ID unlock on for, for
--   one web address (a passkey only works on the address it was made on).
--   Holds the device's PUBLIC key only -- nothing biometric ever leaves the
--   phone. Added and used only through this app's server; a person can see
--   and remove their own; an Admin can remove someone's (lost phone).
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings add column if not exists idle_lock_minutes integer
  check (idle_lock_minutes is null or idle_lock_minutes in (2, 5, 10, 15, 30));

create table if not exists session_activity (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_active_at timestamptz not null default now()
);
create index if not exists session_activity_last_idx on session_activity (last_active_at);
alter table session_activity enable row level security;
revoke all on session_activity from anon, authenticated;
grant all on session_activity to service_role;

create table if not exists unlock_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  sign_count bigint not null default 0,
  transports text[],
  rp_id text not null,
  label text check (label is null or char_length(label) <= 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists unlock_devices_user_idx on unlock_devices (user_id);
alter table unlock_devices enable row level security;
drop policy if exists unlock_devices_select on unlock_devices;
create policy unlock_devices_select on unlock_devices for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on unlock_devices from anon, authenticated;
grant select on unlock_devices to authenticated;
grant all on unlock_devices to service_role;

-- This sign-in's id (the Supabase session in the sign-in token).
create or replace function my_session_id()
returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

-- Only this app's server may unlock or add an unlock device: it sends the
-- check-in server key (0080). Unlike the check-in lock, this one is never
-- "not switched on yet".
create or replace function app_server_check()
returns void language plpgsql stable security definer as $$
declare v_hash text; v_given text;
begin
  select key_sha256 into v_hash from checkin_guard where id = 1;
  begin
    v_given := nullif(current_setting('request.headers', true), '')::json ->> 'x-checkin-key';
  exception when others then
    v_given := null;
  end;
  if v_hash is null or v_given is null or encode(sha256(convert_to(v_given, 'UTF8')), 'hex') <> v_hash then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end
$$;

-- The lock setting on this address and whether this sign-in is locked.
-- p_touch: the person is active right now -- note it, unless already locked.
-- A sign-in seen for the first time starts unlocked (it has just signed in).
create or replace function screen_lock_state(p_touch boolean default false)
returns table (lock_minutes integer, locked boolean)
language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := my_session_id();
  v_min integer;
  v_last timestamptz;
  v_locked boolean := false;
begin
  if v_uid is null or v_sid is null then
    return;
  end if;
  select a.idle_lock_minutes into v_min from app_settings a where a.ministry_id = current_ministry_id();
  if v_min is null then
    return query select null::integer, false;
    return;
  end if;
  select s.last_active_at into v_last from session_activity s where s.session_id = v_sid;
  if v_last is null then
    insert into session_activity (session_id, user_id) values (v_sid, v_uid) on conflict (session_id) do nothing;
    delete from session_activity where last_active_at < now() - interval '30 days';
  else
    v_locked := v_last < now() - make_interval(mins => v_min) - interval '1 minute';
    if p_touch and not v_locked then
      update session_activity set last_active_at = now() where session_id = v_sid;
    end if;
  end if;
  return query select v_min, v_locked;
end
$$;

-- Called by this app's server once it has checked Face ID or an
-- authenticator code.
create or replace function unlock_session()
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_sid uuid := my_session_id();
begin
  perform app_server_check();
  if v_uid is null or v_sid is null then
    raise exception 'Please sign in again';
  end if;
  insert into session_activity (session_id, user_id, last_active_at) values (v_sid, v_uid, now())
  on conflict (session_id) do update set last_active_at = now()
  where session_activity.user_id = v_uid;
end
$$;

create or replace function add_unlock_device(p_credential_id text, p_public_key text, p_sign_count bigint,
                                             p_transports text[], p_rp_id text, p_label text)
returns uuid language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  perform app_server_check();
  if v_uid is null then
    raise exception 'Please sign in again';
  end if;
  if (select count(*) from unlock_devices where user_id = v_uid) >= 10 then
    raise exception 'You already have 10 devices set up. Remove one first.';
  end if;
  insert into unlock_devices (user_id, credential_id, public_key, sign_count, transports, rp_id, label)
  values (v_uid, p_credential_id, p_public_key, greatest(coalesce(p_sign_count, 0), 0), p_transports, p_rp_id,
          nullif(left(btrim(coalesce(p_label, '')), 60), ''))
  returning id into v_id;
  return v_id;
end
$$;

-- After a successful Face ID check: the device's new signature counter.
create or replace function use_unlock_device(p_credential_id text, p_sign_count bigint)
returns boolean language plpgsql security definer as $$
begin
  perform app_server_check();
  update unlock_devices set sign_count = greatest(sign_count, coalesce(p_sign_count, 0)), last_used_at = now()
  where credential_id = p_credential_id and user_id = auth.uid();
  return found;
end
$$;

create or replace function remove_unlock_device(p_id uuid)
returns boolean language plpgsql security definer as $$
begin
  delete from unlock_devices where id = p_id and user_id = auth.uid();
  return found;
end
$$;

-- Access Maintenance (a lost phone): an Admin of this ministry, or the
-- Church Admin, removes all of someone's Face ID devices.
create or replace function reset_person_unlock_devices(p_user_id uuid)
returns integer language plpgsql security definer as $$
declare v_m text := current_ministry_id(); v_n integer;
begin
  if not (is_admin_in(v_m) or is_church_admin()) then
    raise exception 'Only Admins can remove someone''s Face ID devices';
  end if;
  if not exists (select 1 from profiles where ministry_id = v_m and id = p_user_id) and not is_church_admin() then
    raise exception 'Person not found';
  end if;
  delete from unlock_devices where user_id = p_user_id;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array[
    'my_session_id()', 'app_server_check()', 'screen_lock_state(boolean)', 'unlock_session()',
    'add_unlock_device(text, text, bigint, text[], text, text)', 'use_unlock_device(text, bigint)',
    'remove_unlock_device(uuid)', 'reset_person_unlock_devices(uuid)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'screen_lock_state(boolean)', 'unlock_session()', 'add_unlock_device(text, text, bigint, text[], text, text)',
    'use_unlock_device(text, bigint)', 'remove_unlock_device(uuid)', 'reset_person_unlock_devices(uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
