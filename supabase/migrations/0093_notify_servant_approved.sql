-- 0093_notify_servant_approved.sql -- PHONE NOTIFICATION: "YOU'RE APPROVED"
-- (owner-requested 6 Oct 2026). When an Admin or GC approves a pending
-- servant, that servant's own devices get "You're approved", opening the
-- app. Builds on 0092. Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0093_notify_servant_approved.sql; commit;
-- Undo with 0093_down_notify_servant_approved.sql.
--
-- * notification_outbox gains audience 'person' with target_user_id (the
--   one person it's for); 'admins_gcs' messages keep it empty.
-- * The servant is the person who submitted the registration while signed
--   in, or else the account whose confirmed email matches it (someone who
--   registered at a check-in poster and then signed in to wait). Queued
--   only if that person has notifications on for this ministry -- nobody
--   else is ever sent it.
-- * Not sent when the registration is merely tidied up for someone who
--   already has access (absorb_own_pending_registration, which links it in
--   the same step).
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table notification_outbox add column if not exists target_user_id uuid;
alter table notification_outbox drop constraint if exists notification_outbox_audience_check;
alter table notification_outbox add constraint notification_outbox_audience_check
  check (audience in ('admins_gcs', 'person'));
alter table notification_outbox drop constraint if exists notification_outbox_target_check;
alter table notification_outbox add constraint notification_outbox_target_check
  check ((audience = 'person') = (target_user_id is not null));

-- This app's server: as 0092, plus messages for one person.
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
         ), '[]'::jsonb)
  from claimed c;
end
$$;

-- Event 2: a pending servant was approved.
create or replace function notify_servant_approved()
returns trigger language plpgsql security definer as $$
declare v_target uuid;
begin
  if old.approved_at is null and new.approved_at is not null and new.resulting_profile_id is null then
    v_target := new.submitted_by_profile_id;
    if v_target is null and nullif(btrim(new.email), '') is not null then
      select u.id into v_target from auth.users u
      where lower(u.email) = lower(btrim(new.email)) and u.email_confirmed_at is not null
      limit 1;
    end if;
    if v_target is not null
       and exists (select 1 from push_subscriptions s where s.user_id = v_target and s.ministry_id = new.ministry_id) then
      insert into notification_outbox (ministry_id, event, audience, target_user_id, title, body, url)
      values (new.ministry_id, 'servant_approved', 'person', v_target, 'You''re approved!',
              'Your registration was approved. Tap to open Ministry Hub and get started.', '/');
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_servant_approved on pending_servants;
create trigger trg_notify_servant_approved after update of approved_at on pending_servants
  for each row execute function notify_servant_approved();

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['push_claim(integer)', 'notify_servant_approved()'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
  execute 'revoke all on function notify_servant_approved() from public, anon, authenticated';
end
$$;
