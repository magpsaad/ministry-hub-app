-- 0095_down_servant_notifications.sql -- undoes 0095: no servant
-- notifications, no weekly schedule; My Settings back to 0094's.
-- (pg_cron and pg_net stay enabled -- they're database-wide.)
--     begin; set local search_path to qa; \i 0095_down_servant_notifications.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if exists (select 1 from cron.job where jobname = 'ministry-hub-notify-' || current_schema()) then
    perform cron.unschedule('ministry-hub-notify-' || current_schema());
  end if;
end
$$;

drop trigger if exists trg_stage_newly_assigned on members;
drop function if exists stage_newly_assigned();
drop function if exists notify_tick();
drop function if exists notify_person(text, text, uuid, text, text);
drop function if exists notification_yellow(text);
drop function if exists notify_bday_this_year(date, integer);
drop function if exists notify_short(text);
drop function if exists notify_names(text[]);
drop function if exists notify_wants(text, uuid, text);
drop function if exists set_notification_schedule(text, smallint, smallint);
drop table if exists notification_dispatch;
drop table if exists notification_staged;
drop table if exists notification_marks;

delete from notification_outbox where event in ('outreach_needed', 'newly_assigned', 'follow_up_due', 'birthday', 'weekly_recap');
delete from notification_events where event in ('outreach_needed', 'newly_assigned', 'follow_up_due', 'birthday', 'weekly_recap');
alter table notification_preferences drop constraint if exists notification_preferences_weekly_check;
alter table notification_preferences drop column if exists weekly_day;
alter table notification_preferences drop column if exists weekly_hour;

drop function if exists my_notification_settings();
create function my_notification_settings()
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

do $$
begin
  execute format('alter function my_notification_settings() set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function my_notification_settings() from public, anon, authenticated';
  execute 'grant execute on function my_notification_settings() to authenticated, service_role';
end
$$;
