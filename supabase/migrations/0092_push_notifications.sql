-- 0092_push_notifications.sql -- PHONE NOTIFICATIONS (WEB PUSH)
-- (owner-requested 5 Oct 2026). First event: a new servant waiting for
-- approval -> the ministry's Admins and General Coordinators.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0092_push_notifications.sql; commit;
-- Undo with 0092_down_push_notifications.sql.
--
-- * push_subscriptions: each device a person turned notifications on for, on
--   one ministry's address (a phone's notification "address" from Apple /
--   Google plus its encryption keys -- nothing else about the phone). A
--   person sees and removes their own; added only through the functions
--   below.
-- * notification_outbox: messages waiting to go out. Filled by database
--   triggers -- so no way of creating, say, a pending servant can be missed
--   -- and sent by this app's server (it proves itself with the check-in
--   server key, 0080), which marks them sent and drops devices Apple /
--   Google say are gone. Nobody reads or writes it through the API.
-- * Event 1: a new row in pending_servants -> "New servant waiting for
--   approval", to every Admin and GC of that ministry (deactivated people
--   excluded), opening Pending Servants when tapped. The name is shortened
--   (first name, last initial) because notifications show on lock screens.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ministry_id text not null references ministries(id),
  endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  label text check (label is null or char_length(label) <= 60),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id, ministry_id);
alter table push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select on push_subscriptions;
create policy push_subscriptions_select on push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on push_subscriptions from anon, authenticated;
grant select on push_subscriptions to authenticated;
grant all on push_subscriptions to service_role;

create table if not exists notification_outbox (
  id bigint generated always as identity primary key,
  ministry_id text not null references ministries(id),
  event text not null,
  audience text not null check (audience in ('admins_gcs')),
  title text not null,
  body text not null,
  url text not null check (url like '/%'),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text
);
create index if not exists notification_outbox_unsent_idx on notification_outbox (created_at) where sent_at is null;
alter table notification_outbox enable row level security;
revoke all on notification_outbox from anon, authenticated;
grant all on notification_outbox to service_role;

-- This device: turn notifications on (or refresh its keys) for me, here.
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns uuid language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id(); v_id uuid;
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then
    raise exception 'Please sign in again';
  end if;
  if (select count(*) from push_subscriptions where user_id = v_uid) >= 20 then
    raise exception 'Too many devices have notifications on. Turn some off first.';
  end if;
  insert into push_subscriptions (user_id, ministry_id, endpoint, p256dh, auth, label)
  values (v_uid, v_m, btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), nullif(left(btrim(coalesce(p_label, '')), 60), ''))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, ministry_id = excluded.ministry_id, p256dh = excluded.p256dh,
        auth = excluded.auth, label = excluded.label
  returning id into v_id;
  return v_id;
end
$$;

create or replace function remove_push_subscription(p_endpoint text)
returns boolean language plpgsql security definer as $$
begin
  delete from push_subscriptions where endpoint = btrim(p_endpoint) and user_id = auth.uid();
  return found;
end
$$;

-- This app's server: take up to p_limit messages to send, with the devices
-- they go to. A message taken but not marked sent is offered again after
-- two minutes, at most five times; anything older than a day is no longer
-- sent (stale news).
create or replace function push_claim(p_limit integer default 20)
returns table (outbox_id bigint, title text, body text, url text, devices jsonb)
language plpgsql security definer as $$
begin
  perform app_server_check();
  return query
  with picked as (
    select o.id from notification_outbox o
    where o.sent_at is null and o.attempts < 5 and o.created_at > now() - interval '1 day'
      and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), claimed as (
    update notification_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select c.id, c.title, c.body, c.url,
         coalesce((
           select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
           from push_subscriptions s
           where s.ministry_id = c.ministry_id
             and c.audience = 'admins_gcs'
             and exists (select 1 from user_roles ur
                         where ur.ministry_id = c.ministry_id and ur.user_id = s.user_id
                           and ur.role in ('admin', 'general_coordinator'))
             and not exists (select 1 from profiles p
                             where p.ministry_id = c.ministry_id and p.id = s.user_id and p.deactivated_at is not null)
         ), '[]'::jsonb)
  from claimed c;
end
$$;

-- This app's server: a message went out; forget devices that are gone.
create or replace function push_mark_sent(p_outbox_id bigint, p_sent_endpoints text[], p_gone_endpoints text[], p_error text)
returns void language plpgsql security definer as $$
begin
  perform app_server_check();
  update notification_outbox
     set sent_at = case when p_error is null then now() else sent_at end,
         last_error = left(p_error, 500)
   where id = p_outbox_id;
  update push_subscriptions set last_sent_at = now() where endpoint = any(coalesce(p_sent_endpoints, '{}'));
  delete from push_subscriptions where endpoint = any(coalesce(p_gone_endpoints, '{}'));
end
$$;

-- Event 1: a new servant waiting for approval.
create or replace function notify_pending_servant()
returns trigger language plpgsql security definer as $$
declare v_name text := nullif(btrim(new.full_name), '');
begin
  if new.approved_at is null then
    insert into notification_outbox (ministry_id, event, audience, title, body, url)
    values (new.ministry_id, 'pending_servant', 'admins_gcs', 'New servant waiting for approval',
            coalesce(case when v_name is not null then checkin_short_name(v_name, false) end, 'Someone') || ' registered and is waiting for your approval.',
            '/admin/pending-servants');
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_pending_servant on pending_servants;
create trigger trg_notify_pending_servant after insert on pending_servants
  for each row execute function notify_pending_servant();

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array[
    'save_push_subscription(text, text, text, text)', 'remove_push_subscription(text)',
    'push_claim(integer)', 'push_mark_sent(bigint, text[], text[], text)', 'notify_pending_servant()'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'save_push_subscription(text, text, text, text)', 'remove_push_subscription(text)',
    'push_claim(integer)', 'push_mark_sent(bigint, text[], text[], text)'
  ] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- The server sends without anyone signed in (a check-in poster creates
  -- pending servants too); the server key is what it proves itself with.
  execute 'grant execute on function push_claim(integer) to anon';
  execute 'grant execute on function push_mark_sent(bigint, text[], text[], text) to anon';
end
$$;
