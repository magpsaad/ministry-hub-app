-- 0116_down_my_servants_team.sql -- undoes 0116_my_servants_team.sql.
--     begin; set local search_path to qa; \i 0116_down_my_servants_team.sql; commit;
-- Servants' birthdays, last-seen times and Dashboard panel choices are
-- deleted with it. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

do $$
declare n text;
begin
  n := pg_get_functiondef('notify_tick()'::regprocedure);
  n := replace(n, E'  v_url text;\n  v_team text;\nbegin', E'  v_url text;\nbegin');
  n := replace(n, E'      v_queued := v_queued + notify_servant_birthdays(r.id, v_today);\n', '');
  n := replace(n, E'        v_team := servant_team_line(r.id, rec.uid);\n', '');
  n := replace(n, ' or v_team is not null then', ' then');
  n := replace(n,
    E'            case when cardinality(v_parts) > 0 then array_to_string(v_parts, '' · '') || ''. '' else '''' end\n            || coalesce(v_team || ''. '', '''') || ''Tap to see them on your Dashboard.'');',
    E'            array_to_string(v_parts, '' · '') || ''. Tap to see them on your Dashboard.'');');
  if position('v_team' in n) > 0 or position('notify_servant_birthdays' in n) > 0 then
    raise exception 'notify_tick has changed; undo it by hand';
  end if;
  execute n;
end
$$;

update notification_events set description = 'On the birthday of each youth assigned to you.' where event = 'birthday';
update notification_events
set description = 'How many of your youths need outreach, are newly assigned, have follow-ups due or birthdays coming up.'
where event = 'weekly_recap';

drop function if exists notify_servant_birthdays(text, date);
drop function if exists servant_team_line(text, uuid);
drop function if exists my_servant_team();
drop function if exists servant_team(text, uuid);
drop function if exists snooze_birthday_prompt(integer);
drop function if exists set_dashboard_pref(text, boolean);
drop function if exists my_dashboard_prefs();
drop function if exists note_seen();
drop table if exists dashboard_prefs;
drop table if exists last_seen;

alter table app_settings drop constraint if exists app_settings_servant_team_valid;
alter table app_settings drop column if exists servant_absence_weeks, drop column if exists servant_quiet_days;

revoke update (birthday_month, birthday_day) on profiles from authenticated;
alter table profiles drop constraint if exists profiles_birthday_valid;
alter table profiles drop column if exists birthday_month, drop column if exists birthday_day, drop column if exists birthday_ask_after;
