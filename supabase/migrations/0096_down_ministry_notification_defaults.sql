-- 0096_down_ministry_notification_defaults.sql -- undoes 0096: back to the
-- church-wide defaults only (notification_events.default_on).
--     begin; set local search_path to qa; \i 0096_down_ministry_notification_defaults.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function notify_wants(p_ministry text, p_user uuid, p_event text)
returns boolean language sql stable security definer as $$
  select exists (select 1 from push_subscriptions s where s.ministry_id = p_ministry and s.user_id = p_user)
     and exists (select 1 from notification_events ne
                 join user_roles ur on ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role::text = any(ne.roles)
                 where ne.event = p_event)
     and not exists (select 1 from profiles p where p.ministry_id = p_ministry and p.id = p_user and p.deactivated_at is not null)
     and coalesce((select np.enabled from notification_preferences np
                   where np.user_id = p_user and np.ministry_id = p_ministry and np.event = p_event),
                  (select ne.default_on from notification_events ne where ne.event = p_event), false)
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
                          (select ne.default_on from notification_events ne where ne.event = c.event),
                          true)
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
  select ne.event, ne.label, ne.description, coalesce(np.enabled, ne.default_on),
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
  values (v_uid, v_m, p_event, (select default_on from notification_events where event = p_event), p_day, p_hour)
  on conflict (user_id, ministry_id, event) do update
    set weekly_day = excluded.weekly_day, weekly_hour = excluded.weekly_hour, updated_at = now();
  return true;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['notify_wants(text, uuid, text)', 'push_claim(integer)', 'my_notification_settings()',
                           'set_notification_schedule(text, smallint, smallint)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
end
$$;

drop function if exists set_ministry_notification_default(text, boolean);
drop function if exists ministry_notification_defaults();
drop function if exists notification_default(text, text);
drop table if exists notification_ministry_defaults;
