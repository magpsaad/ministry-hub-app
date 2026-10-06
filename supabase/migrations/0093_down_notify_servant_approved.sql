-- 0093_down_notify_servant_approved.sql -- undoes 0093: no "you're
-- approved" notification; push_claim back to 0092's (Admins/GCs only).
--     begin; set local search_path to qa; \i 0093_down_notify_servant_approved.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop trigger if exists trg_notify_servant_approved on pending_servants;
drop function if exists notify_servant_approved();
delete from notification_outbox where audience = 'person';
alter table notification_outbox drop constraint if exists notification_outbox_target_check;
alter table notification_outbox drop constraint if exists notification_outbox_audience_check;
alter table notification_outbox add constraint notification_outbox_audience_check check (audience in ('admins_gcs'));
alter table notification_outbox drop column if exists target_user_id;

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

do $$
begin
  execute format('alter function push_claim(integer) set search_path = %I, public, pg_temp', current_schema());
end
$$;
