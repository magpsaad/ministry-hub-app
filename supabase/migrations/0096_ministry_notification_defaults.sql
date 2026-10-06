-- 0096_ministry_notification_defaults.sql -- MINISTRY SETTINGS ->
-- NOTIFICATION DEFAULTS (owner-requested 6 Oct 2026). Each ministry's
-- Admins choose whether each kind of notification starts on or off for
-- their people; the church-wide starting point (notification_events.
-- default_on, set when each kind was added) applies until they change it.
-- A person who already flipped a switch in My Settings keeps their own
-- choice; everyone else follows the ministry's default, including when an
-- Admin changes it later. Builds on 0094-0095. Run once per environment,
-- QA first:
--     begin; set local search_path to qa; \i 0096_ministry_notification_defaults.sql; commit;
-- Undo with 0096_down_ministry_notification_defaults.sql.
-- Writes no audit entries (like the rest of Ministry Settings).

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists notification_ministry_defaults (
  ministry_id text not null references ministries(id),
  event text not null references notification_events(event) on delete cascade,
  default_on boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (ministry_id, event)
);
alter table notification_ministry_defaults enable row level security;
revoke all on notification_ministry_defaults from anon, authenticated;
grant all on notification_ministry_defaults to service_role;

-- On or off for someone who hasn't chosen, in this ministry.
create or replace function notification_default(p_ministry text, p_event text)
returns boolean language sql stable security definer as $$
  select coalesce((select d.default_on from notification_ministry_defaults d
                   where d.ministry_id = p_ministry and d.event = p_event),
                  (select ne.default_on from notification_events ne where ne.event = p_event),
                  false)
$$;

-- Ministry Settings: every kind people can choose, with this ministry's
-- default and the church-wide one. Admins of this ministry only.
create or replace function ministry_notification_defaults()
returns table (event text, label text, description text, roles text[], default_on boolean, church_default boolean)
language plpgsql stable security definer as $$
declare v_m text := current_ministry_id();
begin
  if not coalesce(is_admin_in(v_m), false) then
    raise exception 'Only this ministry''s Admins can see this.';
  end if;
  return query
  select ne.event, ne.label, ne.description, ne.roles, notification_default(v_m, ne.event), ne.default_on
  from notification_events ne
  where cardinality(ne.roles) > 0
  order by ne.sort_order, ne.label;
end
$$;

create or replace function set_ministry_notification_default(p_event text, p_on boolean)
returns boolean language plpgsql security definer as $$
declare v_m text := current_ministry_id();
begin
  if not coalesce(is_admin_in(v_m), false) then
    raise exception 'Only this ministry''s Admins can change this.';
  end if;
  if p_on is null or not exists (select 1 from notification_events ne where ne.event = p_event and cardinality(ne.roles) > 0) then
    raise exception 'That notification can''t be changed.';
  end if;
  insert into notification_ministry_defaults (ministry_id, event, default_on, updated_by)
  values (v_m, p_event, p_on, auth.uid())
  on conflict (ministry_id, event) do update
    set default_on = excluded.default_on, updated_at = now(), updated_by = excluded.updated_by;
  return p_on;
end
$$;

-- The four places that read a default now ask notification_default().
create or replace function notify_wants(p_ministry text, p_user uuid, p_event text)
returns boolean language sql stable security definer as $$
  select exists (select 1 from push_subscriptions s where s.ministry_id = p_ministry and s.user_id = p_user)
     and exists (select 1 from notification_events ne
                 join user_roles ur on ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role::text = any(ne.roles)
                 where ne.event = p_event)
     and not exists (select 1 from profiles p where p.ministry_id = p_ministry and p.id = p_user and p.deactivated_at is not null)
     and coalesce((select np.enabled from notification_preferences np
                   where np.user_id = p_user and np.ministry_id = p_ministry and np.event = p_event),
                  notification_default(p_ministry, p_event))
$$;

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
                          notification_default(c.ministry_id, c.event))
         ), '[]'::jsonb)
  from claimed c;
end
$$;

create or replace function my_notification_settings()
returns table (event text, label text, description text, enabled boolean, weekly_day smallint, weekly_hour smallint)
language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then
    raise exception 'Please sign in again';
  end if;
  return query
  select ne.event, ne.label, ne.description, coalesce(np.enabled, notification_default(v_m, ne.event)),
         case when ne.event = 'weekly_recap' then coalesce(np.weekly_day, 6::smallint) end,
         case when ne.event = 'weekly_recap' then coalesce(np.weekly_hour, 9::smallint) end
  from notification_events ne
  left join notification_preferences np
    on np.event = ne.event and np.user_id = v_uid and np.ministry_id = v_m
  where exists (select 1 from user_roles ur
                where ur.ministry_id = v_m and ur.user_id = v_uid and ur.role::text = any(ne.roles))
  order by ne.sort_order, ne.label;
end
$$;

create or replace function set_notification_schedule(p_event text, p_day smallint, p_hour smallint)
returns boolean language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then
    raise exception 'Please sign in again';
  end if;
  if p_event <> 'weekly_recap' or p_day is null or p_day not between 0 and 6
     or p_hour is null or p_hour not between 9 and 20
     or not exists (select 1 from notification_events ne
                    join user_roles ur on ur.ministry_id = v_m and ur.user_id = v_uid and ur.role::text = any(ne.roles)
                    where ne.event = p_event) then
    raise exception 'That schedule isn''t available.';
  end if;
  insert into notification_preferences (user_id, ministry_id, event, enabled, weekly_day, weekly_hour)
  values (v_uid, v_m, p_event, notification_default(v_m, p_event), p_day, p_hour)
  on conflict (user_id, ministry_id, event) do update
    set weekly_day = excluded.weekly_day, weekly_hour = excluded.weekly_hour, updated_at = now();
  return true;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array[
    'notification_default(text, text)', 'ministry_notification_defaults()', 'set_ministry_notification_default(text, boolean)',
    'notify_wants(text, uuid, text)', 'push_claim(integer)', 'my_notification_settings()',
    'set_notification_schedule(text, smallint, smallint)'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
  foreach f in array array[
    'notification_default(text, text)', 'ministry_notification_defaults()', 'set_ministry_notification_default(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['ministry_notification_defaults()', 'set_ministry_notification_default(text, boolean)'] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
