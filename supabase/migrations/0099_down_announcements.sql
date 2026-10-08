-- 0099_down_announcements.sql -- undoes 0099: no announcements; push_claim
-- back to 0096's, notify_tick back to 0095's.
--     begin; set local search_path to qa; \i 0099_down_announcements.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
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

create or replace function notify_tick()
returns integer language plpgsql security definer as $$
declare
  r record; rec record;
  v_local timestamp; v_today date; v_daytime boolean;
  v_queued int := 0;
  v_names text[]; v_keys text[];
  v_day int; v_hour int; v_y int; v_b int; v_p int; v_g int; v_parts text[];
  v_before int; v_after int; v_label text;
  v_url text;
begin
  for r in
    select m.id, coalesce(s.timezone, 'America/Toronto') tz,
           coalesce(s.birthday_window_days_before, 7) before_days,
           coalesce(s.birthday_window_days_after, 14) after_days
    from ministries m join app_settings s on s.ministry_id = m.id
    where m.is_active
  loop
    v_local := now() at time zone r.tz;
    v_today := v_local::date;
    v_daytime := v_local::time >= time '09:00' and v_local::time < time '21:00';

    if v_daytime then
      -- 1. Outreach needed: every yellow card once, per servant combined.
      if exists (select 1 from push_subscriptions ps
                 where ps.ministry_id = r.id and notify_wants(r.id, ps.user_id, 'outreach_needed')) then
        for rec in
          select y.assigned_servant_id uid,
                 array_agg(notify_short(y.full_name) order by y.full_name) names,
                 array_agg(y.episode) keys
          from notification_yellow(r.id) y
          where y.assigned_servant_id is not null
            and not exists (select 1 from notification_marks k
                            where k.event = 'outreach_needed' and k.target_user_id = y.assigned_servant_id
                              and k.mark_key = y.episode)
            and notify_wants(r.id, y.assigned_servant_id, 'outreach_needed')
          group by y.assigned_servant_id
        loop
          insert into notification_marks (event, target_user_id, mark_key, ministry_id)
          select 'outreach_needed', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
          perform notify_person(r.id, 'outreach_needed', rec.uid, 'Outreach needed',
            notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' hasn''t' else ' haven''t' end
            || ' been at service in a while. Please reach out.');
          v_queued := v_queued + 1;
        end loop;
      end if;

      -- 2. Newly assigned, once that servant's assignments have settled.
      for rec in
        select st.target_user_id uid from notification_staged st
        where st.ministry_id = r.id and st.event = 'newly_assigned'
        group by st.target_user_id
        having max(st.created_at) < now() - interval '2 minutes'
      loop
        select array_agg(notify_short(x.full_name) order by x.full_name) into v_names
        from (select distinct mem.id, mem.full_name
              from notification_staged st
              join members mem on mem.id = st.member_id
              join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
              where st.ministry_id = r.id and st.event = 'newly_assigned' and st.target_user_id = rec.uid
                and mem.assigned_servant_id = rec.uid and mem.is_new_assignment and mem.status::text = 'active') x;
        if v_names is not null and notify_wants(r.id, rec.uid, 'newly_assigned') then
          perform notify_person(r.id, 'newly_assigned', rec.uid, 'Newly assigned to you',
            notify_names(v_names) || case when array_length(v_names, 1) = 1 then ' is' else ' are' end
            || ' now assigned to you. Say hello!');
          v_queued := v_queued + 1;
        end if;
        delete from notification_staged
        where ministry_id = r.id and event = 'newly_assigned' and target_user_id = rec.uid;
      end loop;

      -- 3. Follow-up reminders due today, to the servant who set them.
      for rec in
        select oe.servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(oe.id::text) keys
        from outreach_entries oe
        join members mem on mem.id = oe.member_id
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where oe.ministry_id = r.id and oe.follow_up_due = v_today and oe.follow_up_dismissed_at is null
          and oe.servant_id is not null
          and not exists (select 1 from notification_marks k
                          where k.event = 'follow_up_due' and k.target_user_id = oe.servant_id and k.mark_key = oe.id::text)
          and notify_wants(r.id, oe.servant_id, 'follow_up_due')
        group by oe.servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'follow_up_due', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'follow_up_due', rec.uid, 'Follow-up due today',
          'Your follow-up' || case when array_length(rec.names, 1) = 1 then '' else 's' end
          || ' with ' || notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' is' else ' are' end
          || ' due today.');
        v_queued := v_queued + 1;
      end loop;

      -- 4. Birthdays today, to the assigned servant.
      for rec in
        select mem.assigned_servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(mem.id::text || ':' || v_today::text) keys
        from members mem
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
          and mem.assigned_servant_id is not null
          and notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int) = v_today
          and not exists (select 1 from notification_marks k
                          where k.event = 'birthday' and k.target_user_id = mem.assigned_servant_id
                            and k.mark_key = mem.id::text || ':' || v_today::text)
          and notify_wants(r.id, mem.assigned_servant_id, 'birthday')
        group by mem.assigned_servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'birthday', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'birthday', rec.uid, 'Birthday today 🎂',
          case when array_length(rec.names, 1) = 1 then 'Today is ' || rec.names[1] || '''s birthday.'
               else 'Today is the birthday of ' || notify_names(rec.names) || '.' end);
        v_queued := v_queued + 1;
      end loop;
    end if;

    -- 5. Weekly recap, on each servant's own day and hour.
    for rec in
      select distinct ps.user_id uid from push_subscriptions ps
      where ps.ministry_id = r.id
        and not exists (select 1 from notification_marks k
                        where k.event = 'weekly_recap' and k.target_user_id = ps.user_id
                          and k.mark_key = 'week:' || v_today::text)
        and notify_wants(r.id, ps.user_id, 'weekly_recap')
    loop
      select coalesce(np.weekly_day, 6), coalesce(np.weekly_hour, 9) into v_day, v_hour
      from (select 1) one
      left join notification_preferences np
        on np.user_id = rec.uid and np.ministry_id = r.id and np.event = 'weekly_recap';
      if extract(dow from v_local)::int = v_day and extract(hour from v_local)::int >= v_hour then
        select count(*) into v_y from notification_yellow(r.id) y where y.assigned_servant_id = rec.uid;
        select count(*) into v_b from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.is_new_assignment
            and mem.assigned_servant_id = rec.uid;
        select count(*) into v_p from outreach_entries oe
          join members mem on mem.id = oe.member_id
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where oe.ministry_id = r.id and oe.servant_id = rec.uid and oe.follow_up_due is not null
            and oe.follow_up_dismissed_at is null and oe.follow_up_due <= v_today;
        select count(*) into v_g from (
          select (notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int)
                  - make_date(extract(year from v_today)::int, 1, 1))
                 - (v_today - make_date(extract(year from v_today)::int, 1, 1)) diff
          from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
            and mem.assigned_servant_id = rec.uid
        ) b
        where (case when b.diff < -r.before_days then b.diff + 365
                    when b.diff > r.after_days then b.diff - 365 else b.diff end) between -r.before_days and r.after_days;

        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        values ('weekly_recap', rec.uid, 'week:' || v_today::text, r.id) on conflict do nothing;
        if v_y + v_b + v_p + v_g > 0 then
          v_parts := array[]::text[];
          if v_y > 0 then v_parts := v_parts || (v_y || ' need' || case when v_y = 1 then 's' else '' end || ' outreach'); end if;
          if v_b > 0 then v_parts := v_parts || (v_b || ' newly assigned'); end if;
          if v_p > 0 then v_parts := v_parts || (v_p || ' follow-up' || case when v_p = 1 then '' else 's' end || ' due'); end if;
          if v_g > 0 then v_parts := v_parts || (v_g || ' birthday' || case when v_g = 1 then '' else 's' end); end if;
          perform notify_person(r.id, 'weekly_recap', rec.uid, 'Your weekly recap',
            array_to_string(v_parts, ' · ') || '. Tap to see them on your Dashboard.');
          v_queued := v_queued + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- Housekeeping.
  delete from notification_marks where created_at < now() - interval '400 days';
  delete from notification_staged where created_at < now() - interval '3 days';

  -- Ask this environment's app to send what was queued.
  if v_queued > 0 then
    begin
      select url into v_url from notification_dispatch where id = 1;
      if v_url is not null then
        perform net.http_post(url := v_url, body := '{}'::jsonb,
                              headers := '{"Content-Type": "application/json"}'::jsonb);
      end if;
    exception when others then
      null; -- the next visit to the app sends them anyway (0092 catch-up)
    end;
  end if;
  return v_queued;
end
$$;

delete from notification_outbox where audience = 'announcement';
alter table notification_outbox drop constraint if exists notification_outbox_announcement_check;
alter table notification_outbox drop constraint if exists notification_outbox_audience_check;
alter table notification_outbox add constraint notification_outbox_audience_check check (audience in ('admins_gcs', 'person'));
alter table notification_outbox drop column if exists announcement_id;
delete from notification_preferences where event = 'announcement';
delete from notification_ministry_defaults where event = 'announcement';
delete from notification_events where event = 'announcement';

drop function if exists checkin_announcements(uuid);
drop function if exists announcement_read_list(uuid);
drop function if exists mark_announcement(uuid, text);
drop function if exists my_current_announcements();
drop function if exists my_announcement_badge();
drop function if exists my_announcements();
drop function if exists announcement_audience_count(text[], uuid[]);
drop function if exists take_down_announcement(uuid);
drop function if exists post_announcement(uuid, text, text, text, text, text[], uuid[], boolean, date, date, text[]);
drop function if exists announcement_enqueue(uuid);
drop function if exists announcement_normalize(text, text[], uuid[]);
drop function if exists my_coordinated_groups(text, uuid);
drop function if exists announcement_is_for(uuid, uuid);
drop function if exists announcement_audience(text, text[], uuid[], uuid[]);
drop function if exists announcement_today(text);
drop table if exists announcement_reads;
drop table if exists announcements;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['push_claim(integer)', 'notify_tick()'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
end
$$;
