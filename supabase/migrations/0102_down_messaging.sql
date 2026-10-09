-- 0102_down_messaging.sql -- undo 0102_messaging.sql (removes every message,
-- conversation and task, and the two notification kinds).
--     begin; set local search_path to qa; \i 0102_down_messaging.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- notify_tick as it was after 0099 (no "due tomorrow").
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
      for rec in
        select a.id from announcements a
        where a.ministry_id = r.id and a.notified_at is null and a.taken_down_at is null
          and a.starts_on <= v_today and a.ends_on >= v_today
      loop
        perform announcement_enqueue(rec.id);
        v_queued := v_queued + 1;
      end loop;

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

  delete from notification_marks where created_at < now() - interval '400 days';
  delete from notification_staged where created_at < now() - interval '3 days';

  if v_queued > 0 then
    begin
      select url into v_url from notification_dispatch where id = 1;
      if v_url is not null then
        perform net.http_post(url := v_url, body := '{}'::jsonb,
                              headers := '{"Content-Type": "application/json"}'::jsonb);
      end if;
    exception when others then
      null;
    end;
  end if;
  return v_queued;
end
$$;
do $$
declare s text := current_schema();
begin
  execute format('alter function notify_tick() set search_path = %I, public, pg_temp', s);
  execute 'revoke all on function notify_tick() from public, anon, authenticated';
end
$$;

drop function if exists notify_tasks_due(text, date);
drop function if exists message_people();
drop function if exists my_unread_messages();
drop function if exists get_conversation(uuid);
drop function if exists my_conversations(text);
drop function if exists mark_conversation_read(uuid);
drop function if exists set_task_done(uuid, boolean, text);
drop function if exists edit_message(uuid, text);
drop function if exists reply_message(uuid, text);
drop function if exists send_message(uuid[], uuid[], text, text, boolean, date, text);
drop function if exists message_notify(uuid, uuid, text, text);
drop function if exists message_is_member(uuid, uuid);
drop function if exists message_oversees(text, uuid);
drop function if exists message_person_ok(text, uuid);
drop function if exists person_name(text, uuid);

delete from notification_outbox where event in ('message', 'task_due');
delete from notification_marks where event = 'task_due';
delete from notification_preferences where event in ('message', 'task_due');
delete from notification_ministry_defaults where event in ('message', 'task_due');
delete from notification_events where event in ('message', 'task_due');

drop table if exists messages;
drop table if exists conversation_members;
drop table if exists conversations;

alter table app_settings drop constraint if exists app_settings_message_oversight_check;
alter table app_settings drop column if exists message_oversight;
