-- 0101_down_announcements_servants.sql -- undoes 0101: Servants can't post
-- announcements again (0100's rule). Their youths-only posts are removed.
--     begin; set local search_path to qa; \i 0101_down_announcements_servants.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

delete from announcements a
where a.roles = '{}' and not exists (select 1 from user_roles ur where ur.ministry_id = a.ministry_id and ur.user_id = a.author_id
                                     and ur.role in ('sub_coordinator', 'general_coordinator', 'admin'));

create or replace function announcement_normalize(p_ministry text, p_roles text[], p_groups uuid[], p_youth boolean,
  out o_roles text[], out o_sg uuid[], out o_cg uuid[])
language plpgsql stable security definer as $$
declare
  v_full boolean := coalesce(is_admin_or_gc_in(p_ministry), false);
  v_mine uuid[];
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
  if not (coalesce(is_coordinator_in(p_ministry), false) and cardinality(my_coordinated_groups(p_ministry)) > 0) then
    raise exception 'Only Admins, General Coordinators and Coordinators can post announcements.';
  end if;
  v_mine := my_coordinated_groups(p_ministry);
  o_roles := coalesce(p_roles, '{}');
  if not (o_roles <@ array['servant']) then
    raise exception 'Coordinators can post to the Servants or youths of their classes.';
  end if;
  if cardinality(o_roles) = 0 and not coalesce(p_youth, false) then
    raise exception 'Choose the Servants of your classes, the youths, or both.';
  end if;
  if v_groups is not null and not (v_groups <@ v_mine) then
    raise exception 'Coordinators can only pick the classes they coordinate.';
  end if;
  o_sg := coalesce(v_groups, v_mine);
  o_cg := null;
end
$$;

do $$
begin
  execute format('alter function announcement_normalize(text, text[], uuid[], boolean) set search_path = %I, public, pg_temp', current_schema());
end
$$;

drop function if exists my_served_groups(text, uuid);
