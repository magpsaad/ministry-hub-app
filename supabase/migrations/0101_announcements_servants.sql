-- 0101_announcements_servants.sql -- SERVANTS POST TO THEIR CLASS'S YOUTHS
-- (owner-requested 8 Oct 2026). A Servant can post an announcement for the
-- youths of the class(es) they serve -- all of them, not just those
-- assigned to them -- shown on the check-in page after the youth checks
-- in. Youths only (roles = '{}'): a Servant can't announce to other app
-- users. Coordinators keep 0100's rule (Servants and/or youths of the
-- classes they coordinate); a Coordinator who also serves a class can post
-- to that class's youths too. Admins / GCs unchanged.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0101_announcements_servants.sql; commit;
-- Undo with 0101_down_announcements_servants.sql.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

-- The classes this person serves here (servant grants with a class).
create or replace function my_served_groups(p_ministry text, p_user uuid default auth.uid())
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(distinct ur.group_id) filter (where ur.group_id is not null), '{}')
  from user_roles ur where ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role = 'servant'
$$;

create or replace function announcement_normalize(p_ministry text, p_roles text[], p_groups uuid[], p_youth boolean,
  out o_roles text[], out o_sg uuid[], out o_cg uuid[])
language plpgsql stable security definer as $$
declare
  v_full boolean := coalesce(is_admin_or_gc_in(p_ministry), false);
  v_coord uuid[] := '{}';
  v_serve uuid[] := '{}';
  v_any uuid[];
  v_groups uuid[] := nullif(p_groups, '{}');
begin
  if p_roles is not null and not (p_roles <@ array['servant', 'sub_coordinator', 'general_coordinator', 'admin', 'read_only']) then
    raise exception 'Unknown role in who it''s for.';
  end if;
  if v_groups is not null and exists (select 1 from unnest(v_groups) g
                                      where not exists (select 1 from groups x where x.id = g and x.ministry_id = p_ministry)) then
    raise exception 'Group not found';
  end if;
  if v_full then
    o_roles := nullif(p_roles, '{}');
    if o_roles is not null and ('servant' = any(o_roles) or 'sub_coordinator' = any(o_roles)) then
      o_sg := v_groups; o_cg := v_groups;
    end if;
    return;
  end if;
  if coalesce(is_coordinator_in(p_ministry), false) then v_coord := my_coordinated_groups(p_ministry); end if;
  if coalesce(is_app_user_in(p_ministry), false) then v_serve := my_served_groups(p_ministry); end if;
  if cardinality(v_coord) = 0 and cardinality(v_serve) = 0 then
    raise exception 'Only Admins, General Coordinators, Coordinators and Servants of a class can post announcements.';
  end if;
  o_roles := coalesce(p_roles, '{}');
  o_cg := null;
  if cardinality(o_roles) > 0 then
    -- Servants of the classes: Coordinators only, their classes only.
    if not (o_roles <@ array['servant']) or cardinality(v_coord) = 0 then
      raise exception 'You can post to the youths of your class%', case when cardinality(v_coord) > 0 then ', or to the Servants and youths of the classes you coordinate.' else '.' end;
    end if;
    if v_groups is not null and not (v_groups <@ v_coord) then
      raise exception 'Coordinators can only pick the classes they coordinate.';
    end if;
    o_sg := coalesce(v_groups, v_coord);
  else
    -- Youths only: the classes they coordinate or serve.
    if not coalesce(p_youth, false) then
      raise exception 'Choose who it''s for.';
    end if;
    v_any := array(select distinct g from unnest(v_coord || v_serve) g);
    if v_groups is not null and not (v_groups <@ v_any) then
      raise exception 'You can only pick your own classes.';
    end if;
    o_sg := coalesce(v_groups, v_any);
  end if;
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['my_served_groups(text, uuid)', 'announcement_normalize(text, text[], uuid[], boolean)'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end
$$;
