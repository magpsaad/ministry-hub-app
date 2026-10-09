-- 0100_down_announcements_coordinators.sql -- undoes 0100: Coordinators
-- post to their classes' Servants and/or fellow Coordinators again (0099).
-- Youths-only announcements (roles = '{}') must be removed first.
--     begin; set local search_path to qa; \i 0100_down_announcements_coordinators.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

delete from announcements where roles = '{}';
alter table announcements drop constraint if exists announcements_roles_check;
alter table announcements add constraint announcements_roles_check
  check (roles is null or (cardinality(roles) > 0
                           and roles <@ array['servant', 'sub_coordinator', 'general_coordinator', 'admin', 'read_only']));

drop function if exists announcement_normalize(text, text[], uuid[], boolean);
drop function if exists announcement_audience_count(text[], uuid[], boolean);

create or replace function announcement_normalize(p_ministry text, p_roles text[], p_groups uuid[],
  out o_roles text[], out o_sg uuid[], out o_cg uuid[])
language plpgsql stable security definer as $$
declare
  v_full boolean := coalesce(is_admin_or_gc_in(p_ministry), false);
  v_mine uuid[];
  v_groups uuid[] := nullif(p_groups, '{}');
begin
  o_roles := nullif(p_roles, '{}');
  if o_roles is not null and not (o_roles <@ array['servant', 'sub_coordinator', 'general_coordinator', 'admin', 'read_only']) then
    raise exception 'Unknown role in who it''s for.';
  end if;
  if v_groups is not null and exists (select 1 from unnest(v_groups) g
                                      where not exists (select 1 from groups x where x.id = g and x.ministry_id = p_ministry)) then
    raise exception 'Group not found';
  end if;
  if v_full then
    if o_roles is not null and ('servant' = any(o_roles) or 'sub_coordinator' = any(o_roles)) then
      o_sg := v_groups; o_cg := v_groups;
    end if;
    return;
  end if;
  if not (coalesce(is_coordinator_in(p_ministry), false) and cardinality(my_coordinated_groups(p_ministry)) > 0) then
    raise exception 'Only Admins, General Coordinators and Coordinators can post announcements.';
  end if;
  v_mine := my_coordinated_groups(p_ministry);
  if o_roles is null or not (o_roles <@ array['servant', 'sub_coordinator']) then
    raise exception 'Coordinators can post to the Servants of their classes or to fellow Coordinators.';
  end if;
  if v_groups is not null and not (v_groups <@ v_mine) then
    raise exception 'Coordinators can only pick the classes they coordinate.';
  end if;
  o_sg := coalesce(v_groups, v_mine);
  o_cg := null;
end
$$;

create or replace function post_announcement(
  p_id uuid, p_title text, p_body text, p_link text, p_importance text,
  p_roles text[], p_groups uuid[], p_include_youth boolean, p_starts_on date, p_ends_on date,
  p_ministries text[] default null)
returns uuid[] language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_church uuid;
  v_today date;
  v_local time;
  n record;
  a announcements;
begin
  if v_uid is null then raise exception 'Please sign in again'; end if;
  if p_importance not in ('normal', 'important') then raise exception 'Choose Normal or Important.'; end if;
  if nullif(btrim(coalesce(p_link, '')), '') is not null and btrim(p_link) !~ '^https?://' then
    raise exception 'The link must start with https://';
  end if;

  -- Church Admin, from the console: the same post in each ministry picked.
  if p_ministries is not null then
    if not coalesce(is_church_admin(), false) then raise exception 'Only the Church Admin can post to several ministries.'; end if;
    if p_id is not null then raise exception 'Edit it from the announcement itself.'; end if;
    if nullif(p_groups, '{}') is not null then raise exception 'Classes can''t be picked across ministries.'; end if;
    v_church := gen_random_uuid();
    foreach v_m in array p_ministries loop
      if not coalesce(ministry_exists(v_m), false) then raise exception 'Ministry not found'; end if;
      v_today := announcement_today(v_m);
      if p_ends_on < coalesce(p_starts_on, v_today) or p_ends_on < v_today then raise exception 'The end date must be today or later, and not before the start.'; end if;
      insert into announcements (ministry_id, author_id, title, body, link_url, importance, roles, include_youth,
                                 starts_on, ends_on, church_post_id)
      values (v_m, v_uid, btrim(p_title), btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), p_importance,
              nullif(p_roles, '{}'), coalesce(p_include_youth, false), coalesce(p_starts_on, v_today), p_ends_on, v_church)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;
  else
    v_m := current_ministry_id();
    if not coalesce(ministry_exists(v_m), false) then raise exception 'Please sign in again'; end if;
    select * into n from announcement_normalize(v_m, p_roles, p_groups);
    v_today := announcement_today(v_m);
    if p_ends_on < coalesce(p_starts_on, v_today) or p_ends_on < v_today then raise exception 'The end date must be today or later, and not before the start.'; end if;
    if p_id is null then
      insert into announcements (ministry_id, author_id, title, body, link_url, importance, roles,
                                 servant_group_ids, coordinator_group_ids, include_youth, starts_on, ends_on)
      values (v_m, v_uid, btrim(p_title), btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), p_importance,
              n.o_roles, n.o_sg, n.o_cg, coalesce(p_include_youth, false), coalesce(p_starts_on, v_today), p_ends_on)
      returning id into v_id;
    else
      select * into a from announcements where id = p_id and ministry_id = v_m and taken_down_at is null;
      if a.id is null then raise exception 'Announcement not found'; end if;
      if a.author_id <> v_uid and not coalesce(is_admin_or_gc_in(v_m), false) then
        raise exception 'Only the person who posted it, a General Coordinator or an Admin can edit it.';
      end if;
      update announcements set title = btrim(p_title), body = btrim(p_body), link_url = nullif(btrim(coalesce(p_link, '')), ''),
             importance = p_importance, roles = n.o_roles, servant_group_ids = n.o_sg, coordinator_group_ids = n.o_cg,
             include_youth = coalesce(p_include_youth, false), starts_on = coalesce(p_starts_on, a.starts_on),
             ends_on = p_ends_on, updated_at = now()
      where id = a.id;
      v_id := a.id;
    end if;
    v_ids := array[v_id];
  end if;

  -- Showing already and it's daytime: the phone notification goes now.
  foreach v_id in array v_ids loop
    select * into a from announcements where id = v_id;
    v_local := (now() at time zone coalesce((select s.timezone from app_settings s where s.ministry_id = a.ministry_id), 'America/Toronto'))::time;
    if a.starts_on <= announcement_today(a.ministry_id) and v_local >= time '09:00' and v_local < time '21:00' then
      perform announcement_enqueue(a.id);
    end if;
  end loop;
  return v_ids;
end
$$;

create or replace function announcement_audience_count(p_roles text[], p_groups uuid[])
returns integer language plpgsql stable security definer as $$
declare v_m text := current_ministry_id(); n record;
begin
  select * into n from announcement_normalize(v_m, p_roles, p_groups);
  return (select count(*) from announcement_audience(v_m, n.o_roles, n.o_sg, n.o_cg) x where x.user_id <> auth.uid());
end
$$;

create or replace function announcement_enqueue(p_id uuid)
returns void language plpgsql security definer as $$
declare a announcements;
begin
  select * into a from announcements where id = p_id and notified_at is null and taken_down_at is null;
  if a.id is null then return; end if;
  insert into notification_outbox (ministry_id, event, audience, announcement_id, title, body, url)
  values (a.ministry_id, 'announcement', 'announcement', a.id,
          case when a.importance = 'important' then 'Important: ' else '' end || left(a.title, 110),
          left(a.body, 160), '/announcements');
  update announcements set notified_at = now() where id = a.id;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['announcement_normalize(text, text[], uuid[])',
                           'post_announcement(uuid, text, text, text, text, text[], uuid[], boolean, date, date, text[])',
                           'announcement_audience_count(text[], uuid[])', 'announcement_enqueue(uuid)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
  end loop;
  execute 'revoke all on function announcement_normalize(text, text[], uuid[]) from public, anon, authenticated';
  execute 'revoke all on function announcement_audience_count(text[], uuid[]) from public, anon, authenticated';
  execute 'grant execute on function announcement_audience_count(text[], uuid[]) to authenticated, service_role';
end
$$;
