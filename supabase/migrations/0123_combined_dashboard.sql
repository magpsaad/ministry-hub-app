-- 0123_combined_dashboard.sql -- THE "ALL CLASSES" DASHBOARD IN ONE
-- DATABASE CALL (owner-approved 17 Oct 2026, General Coordinators' pages
-- were slow on a busy service night). The combined Dashboard read youths,
-- all-time attendance and outreach (each in 1000-row pages), the follow-ups
-- due, the last service day and the groups' Servants as separate requests;
-- on the free database each request waits its turn when it's busy.
-- combined_dashboard() returns all of them at once, in the same shapes.
-- SECURITY INVOKER: every table's own security rules apply exactly as they
-- did to the separate requests, so nobody sees anything new.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0123_combined_dashboard.sql; commit;
-- Undo with 0123_down_combined_dashboard.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function combined_dashboard(p_group_ids uuid[], p_today date)
returns jsonb
language sql stable security invoker as $$
  select jsonb_build_object(
    -- getCombinedDashboardData's youths, newest first
    'members', coalesce((
      select jsonb_agg(to_jsonb(x) - 'sort_created' - 'sort_id' order by x.sort_created desc, x.sort_id)
      from (
        select m.id, m.group_id, m.full_name, m.photo_path, m.phone, m.is_visitor, m.assigned_servant_id,
               m.is_new_assignment, m.created_at, m.join_date, m.date_of_birth, m.program_of_study, m.gender,
               case when sp.id is not null then jsonb_build_object('full_name', sp.full_name) end as assigned_servant,
               case when u.id is not null then jsonb_build_object('name', u.name, 'proximity', u.proximity) end as university,
               m.created_at as sort_created, m.id as sort_id
        from members m
        left join profiles sp on sp.ministry_id = m.ministry_id and sp.id = m.assigned_servant_id
        left join universities u on u.ministry_id = m.ministry_id and u.id = m.university_id
        where m.group_id = any(p_group_ids) and m.status = 'active'
      ) x), '[]'::jsonb),
    -- all-time service-day attendance of those youths, newest first
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('member_id', a.member_id, 'service_date', a.service_date)
                       order by a.service_date desc, a.id)
      from attendance_records a
      join members m on m.id = a.member_id
      where a.attendee_type = 'member' and a.event_id is null
        and m.group_id = any(p_group_ids) and m.status = 'active'), '[]'::jsonb),
    -- all-time outreach of those youths, newest first
    'outreach', coalesce((
      select jsonb_agg(jsonb_build_object('member_id', o.member_id, 'occurred_at', o.occurred_at)
                       order by o.occurred_at desc, o.id)
      from outreach_entries o
      join members m on m.id = o.member_id
      where m.group_id = any(p_group_ids) and m.status = 'active'), '[]'::jsonb),
    -- getFollowUpsDue: due today or earlier, not dismissed, soonest first
    'follow_ups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'member_id', o.member_id, 'servant_id', o.servant_id, 'occurred_at', o.occurred_at,
               'type', o.type, 'notes', o.notes, 'follow_up_due', o.follow_up_due,
               'member', jsonb_build_object('full_name', m.full_name, 'phone', m.phone, 'photo_path', m.photo_path,
                                            'assigned_servant_id', m.assigned_servant_id, 'group_id', m.group_id),
               'servant', case when sp.id is not null then jsonb_build_object('full_name', sp.full_name) end)
             order by o.follow_up_due)
      from outreach_entries o
      join members m on m.id = o.member_id
      left join profiles sp on sp.ministry_id = o.ministry_id and sp.id = o.servant_id
      where m.group_id = any(p_group_ids)
        and o.follow_up_due is not null and o.follow_up_dismissed_at is null and o.follow_up_due <= p_today), '[]'::jsonb),
    -- getLastServiceDate: the latest service day with any youth attendance
    'last_service_date', (
      select a.service_date from attendance_records a
      where a.attendee_type = 'member' and a.event_id is null
      order by a.service_date desc limit 1),
    -- getServantsForGroup's Servant roles in these groups
    'servant_roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', r.user_id, 'group_id', r.group_id,
               'profiles', case when p.id is not null then jsonb_build_object('id', p.id, 'full_name', p.full_name, 'gender', p.gender) end,
               'groups', case when g.id is not null then jsonb_build_object('name', g.name, 'ladder_position', g.ladder_position,
                                                                            'display_order', g.display_order) end))
      from user_roles r
      left join profiles p on p.ministry_id = r.ministry_id and p.id = r.user_id
      left join groups g on g.ministry_id = r.ministry_id and g.id = r.group_id
      where r.role = 'servant' and r.group_id = any(p_group_ids)), '[]'::jsonb)
  );
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function combined_dashboard(uuid[], date) set search_path = %I, public, pg_temp', s);
  revoke all on function combined_dashboard(uuid[], date) from public, anon;
  grant execute on function combined_dashboard(uuid[], date) to authenticated;
end
$$;
