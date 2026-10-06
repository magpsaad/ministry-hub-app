-- 0094_notification_preferences.sql -- MY SETTINGS -> NOTIFICATIONS
-- (owner-requested 6 Oct 2026). Each person chooses which notifications
-- they get, per ministry; each kind is listed only for the roles it can
-- ever reach (a regular servant never sees "New servant waiting for
-- approval"). Builds on 0092-0093. Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0094_notification_preferences.sql; commit;
-- Undo with 0094_down_notification_preferences.sql.
--
-- * notification_events: the catalog, one row per kind of notification.
--   EVERY new kind gets a row here in its own migration (the outbox's event
--   must exist in it), with the roles that see it in My Settings (empty =
--   not listed, always sent) and whether it starts on (owner decides each
--   time).
-- * notification_preferences: a person's own choice for one kind on one
--   ministry; no row = the kind's default. Changed only through
--   set_notification_preference().
-- * push_claim leaves out devices whose owner turned that kind off.
-- Writes no audit entries (personal settings, like turning a device on).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists notification_events (
  event text primary key,
  label text not null check (char_length(label) <= 80),
  description text not null check (char_length(description) <= 200),
  roles text[] not null default '{}',
  default_on boolean not null,
  sort_order integer not null default 100
);
alter table notification_events enable row level security;
drop policy if exists notification_events_select on notification_events;
create policy notification_events_select on notification_events for select to authenticated using (true);
revoke all on notification_events from anon, authenticated;
grant select on notification_events to authenticated;
grant all on notification_events to service_role;

insert into notification_events (event, label, description, roles, default_on, sort_order) values
  ('pending_servant', 'New servant waiting for approval',
   'When someone registers as a servant and needs an Admin or GC to approve them.',
   '{admin,general_coordinator}', true, 10),
  ('servant_approved', 'You''re approved',
   'Sent once, to someone waiting for approval, when they''re approved.',
   '{}', true, 20)
on conflict (event) do update
  set label = excluded.label, description = excluded.description, roles = excluded.roles,
      default_on = excluded.default_on, sort_order = excluded.sort_order;

alter table notification_outbox drop constraint if exists notification_outbox_event_fkey;
alter table notification_outbox add constraint notification_outbox_event_fkey
  foreign key (event) references notification_events(event);

create table if not exists notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  ministry_id text not null references ministries(id),
  event text not null references notification_events(event) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, ministry_id, event)
);
alter table notification_preferences enable row level security;
drop policy if exists notification_preferences_select on notification_preferences;
create policy notification_preferences_select on notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on notification_preferences from anon, authenticated;
grant select on notification_preferences to authenticated;
grant all on notification_preferences to service_role;

-- My Settings -> Notifications: the kinds that can reach me here, on or off.
create or replace function my_notification_settings()
returns table (event text, label text, description text, enabled boolean)
language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then
    raise exception 'Please sign in again';
  end if;
  return query
  select ne.event, ne.label, ne.description, coalesce(np.enabled, ne.default_on)
  from notification_events ne
  left join notification_preferences np
    on np.event = ne.event and np.user_id = v_uid and np.ministry_id = v_m
  where exists (select 1 from user_roles ur
                where ur.ministry_id = v_m and ur.user_id = v_uid and ur.role::text = any(ne.roles))
  order by ne.sort_order, ne.label;
end
$$;

create or replace function set_notification_preference(p_event text, p_enabled boolean)
returns boolean language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then
    raise exception 'Please sign in again';
  end if;
  if p_enabled is null or not exists (
    select 1 from notification_events ne
    where ne.event = p_event
      and exists (select 1 from user_roles ur
                  where ur.ministry_id = v_m and ur.user_id = v_uid and ur.role::text = any(ne.roles))
  ) then
    raise exception 'This notification isn''t available to you here.';
  end if;
  insert into notification_preferences (user_id, ministry_id, event, enabled)
  values (v_uid, v_m, p_event, p_enabled)
  on conflict (user_id, ministry_id, event) do update set enabled = excluded.enabled, updated_at = now();
  return p_enabled;
end
$$;

-- This app's server: as 0093, minus devices whose owner turned it off.
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
             and ((c.audience = 'admins_gcs'
                   and exists (select 1 from user_roles ur
                               where ur.ministry_id = c.ministry_id and ur.user_id = s.user_id
                                 and ur.role in ('admin', 'general_coordinator')))
               or (c.audience = 'person' and s.user_id = c.target_user_id))
             and not exists (select 1 from profiles p
                             where p.ministry_id = c.ministry_id and p.id = s.user_id and p.deactivated_at is not null)
             and coalesce((select np.enabled from notification_preferences np
                           where np.user_id = s.user_id and np.ministry_id = c.ministry_id and np.event = c.event),
                          (select ne.default_on from notification_events ne where ne.event = c.event),
                          true)
         ), '[]'::jsonb)
  from claimed c;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['my_notification_settings()', 'set_notification_preference(text, boolean)', 'push_claim(integer)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
  foreach f in array array['my_notification_settings()', 'set_notification_preference(text, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
