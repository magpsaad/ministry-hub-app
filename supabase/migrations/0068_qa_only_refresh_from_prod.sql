-- 0068_qa_only_refresh_from_prod.sql -- QA ONLY. Never run with search_path prod.
--     begin; set local search_path to qa; \i 0068_qa_only_refresh_from_prod.sql; commit;
--
-- "Refresh QA from production" (owner-requested, 30 Sep 2026), run from the
-- QA Church Admin console. For each production ministry the Church Admin
-- ticks, QA's copy of that ministry's data is replaced by production's:
-- settings, groups, youths, attendance, outreach, schools, verses, holiday
-- rules, calendar, QR codes, profiles, roles, pending servants and the
-- audit log. It only READS production; every write is to the qa schema.
--
-- Left alone: QA-only ministries (never offered), QA's web addresses, the
-- Church Admin list, Release Notes, and QA's photo files. Photo links are
-- blanked on the copy (production's files aren't in QA's storage, and QA's
-- youths/groups have different ids from production's); Google profile
-- picture links (http...) are kept since they work anywhere.
--
-- QA-only access (role grants in QA with no match in production, compared
-- by person + role + group NAME, since group ids differ) can be kept: the
-- console lists them, the Church Admin ticks which to keep, and they're put
-- back after the copy (restoring that person's QA profile if production has
-- none). Ticks are remembered in refresh_keep_list for next time.
--
-- Each real run first keeps a copy of QA's data in schema qa_refresh_backup
-- (replaced every run). p_dry_run = true does the whole run, reports the
-- counts, then undoes it. Undo: 0068_down_qa_only_refresh_from_prod.sql.

do $$
begin
  if current_schema() <> 'qa' then
    raise exception 'QA only: run with search_path set to qa (got %)', current_schema();
  end if;
end
$$;

create table refresh_keep_list (
  ministry_id text not null,
  user_id     uuid not null,
  role        text not null,
  group_name  text not null default '',   -- '' = a grant with no group
  created_at  timestamptz not null default now(),
  primary key (ministry_id, user_id, role, group_name)
);

create table refresh_log (
  id         bigint generated always as identity primary key,
  run_at     timestamptz not null default now(),
  run_by     uuid,
  ministries text[] not null,
  dry_run    boolean not null,
  report     jsonb not null
);

alter table refresh_keep_list enable row level security;
alter table refresh_log enable row level security;
revoke all on refresh_keep_list, refresh_log from public, anon, authenticated;
grant all on refresh_keep_list, refresh_log to service_role;

-- Production ministries the Church Admin can choose from.
create or replace function refresh_prod_ministries()
returns table(id text, name text, in_qa boolean)
language plpgsql stable security definer
set search_path = qa, public, pg_temp
as $$
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  return query
    select p.id, p.name, exists (select 1 from qa.ministries q where q.id = p.id)
    from prod.ministries p
    order by p.display_order, p.name;
end
$$;

-- QA grants in the chosen ministries that production doesn't have
-- (same person, role and group name), with whether they were kept last time.
create or replace function refresh_qa_only_access(p_ministries text[])
returns table(ministry_id text, user_id uuid, email text, full_name text, role text, group_name text, kept_before boolean)
language plpgsql stable security definer
set search_path = qa, public, pg_temp
as $$
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  return query
    select r.ministry_id, r.user_id, u.email::text,
           coalesce(nullif(p.full_name, ''), u.email::text, r.user_id::text),
           r.role::text, coalesce(g.name, ''),
           exists (select 1 from qa.refresh_keep_list k
                   where k.ministry_id = r.ministry_id and k.user_id = r.user_id
                     and k.role = r.role::text and k.group_name = coalesce(g.name, ''))
    from qa.user_roles r
    left join qa.groups g on g.id = r.group_id
    left join qa.profiles p on p.ministry_id = r.ministry_id and p.id = r.user_id
    left join auth.users u on u.id = r.user_id
    where r.ministry_id = any(p_ministries)
      and not exists (
        select 1 from prod.user_roles pr
        left join prod.groups pg on pg.id = pr.group_id
        where pr.ministry_id = r.ministry_id and pr.user_id = r.user_id
          and pr.role::text = r.role::text and coalesce(pg.name, '') = coalesce(g.name, ''))
    order by r.ministry_id, 4, r.role::text, 6;
end
$$;

create or replace function refresh_from_prod(p_ministries text[], p_keep jsonb default '[]', p_dry_run boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = qa, public, pg_temp
set lock_timeout = '5s'
as $$
declare
  -- children first for deleting, parents first for inserting
  c_delete text[] := array['attendance_records', 'outreach_entries', 'pending_servant_attendance', 'audit_log',
    'user_roles', 'qr_codes', 'members', 'service_calendar_events', 'holiday_rules', 'pending_servants', 'verses',
    'audit_config', 'actions_needed_config', 'universities', 'groups', 'profiles', 'app_settings'];
  c_insert text[] := array['app_settings', 'profiles', 'universities', 'groups', 'members', 'verses', 'holiday_rules',
    'service_calendar_events', 'pending_servants', 'pending_servant_attendance', 'qr_codes', 'user_roles',
    'attendance_records', 'outreach_entries', 'audit_config', 'actions_needed_config', 'audit_log'];
  c_backup text[] := c_insert || array['ministries', 'refresh_keep_list'];
  v_start timestamptz := clock_timestamp();
  v_report jsonb;
  v_tables jsonb := '{}';
  v_applied jsonb := '[]';
  v_failed jsonb := '[]';
  v_bad text;
  m text;
  t text;
  v_cols text;
  v_sel text;
  n_before bigint;
  n_prod bigint;
  n_after bigint;
  k record;
  v_group uuid;
begin
  if not is_church_admin() then raise exception 'Church Admins only'; end if;
  if p_ministries is null or cardinality(p_ministries) = 0 then raise exception 'Choose at least one ministry'; end if;
  select string_agg(x, ', ') into v_bad from unnest(p_ministries) x where not exists (select 1 from prod.ministries pm where pm.id = x);
  if v_bad is not null then raise exception 'Not a production ministry: %', v_bad; end if;

  begin  -- inner block: a dry run is undone by leaving it with an exception
    -- 1. Keep a copy of QA as it is now (replaced every run).
    drop schema if exists qa_refresh_backup cascade;
    create schema qa_refresh_backup;
    revoke all on schema qa_refresh_backup from public, anon, authenticated;
    foreach t in array c_backup loop
      execute format('create table qa_refresh_backup.%I as table qa.%I', t, t);
    end loop;

    -- 2. Counts before, and the ministry rows (name/order from production;
    --    QA keeps its own active flag and addresses).
    foreach m in array p_ministries loop
      insert into qa.ministries (id, name, is_active, display_order)
        select p.id, p.name, p.is_active, p.display_order from prod.ministries p where p.id = m
      on conflict (id) do update set name = excluded.name, display_order = excluded.display_order;
    end loop;
    foreach t in array c_insert loop
      execute format('select count(*) from qa.%I where ministry_id = any($1)', t) using p_ministries into n_before;
      execute format('select count(*) from prod.%I where ministry_id = any($1)', t) using p_ministries into n_prod;
      v_tables := v_tables || jsonb_build_object(t, jsonb_build_object('before', n_before, 'production', n_prod));
    end loop;

    -- 3. Triggers that would change copied rows on insert stay off.
    alter table qa.attendance_records disable trigger trg_attendance_update_join_date;
    alter table qa.outreach_entries disable trigger trg_outreach_clear_new_assignment;
    alter table qa.user_roles disable trigger trg_ensure_servant_for_sub_coordinator;

    -- 4. Replace: delete QA's rows for these ministries, copy production's.
    foreach t in array c_delete loop
      execute format('delete from qa.%I where ministry_id = any($1)', t) using p_ministries;
    end loop;
    foreach t in array c_insert loop
      -- Columns both schemas have (future QA-first migrations keep working);
      -- enum values re-typed to QA's own types; audit_log gets new QA ids
      -- (its numeric ids could clash with QA-only ministries' rows).
      select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
             string_agg(case
                          when t = 'members' and c.column_name = 'photo_path' then 'null'
                          when t = 'profiles' and c.column_name = 'photo_path'
                            then 'case when photo_path ~* ''^https?://'' then photo_path end'
                          when t = 'service_calendar_events' and c.column_name = 'attachment_url' then 'null'
                          when c.data_type = 'USER-DEFINED' then format('%I::text::%I.%I', c.column_name, c.udt_schema, c.udt_name)
                          else format('%I', c.column_name)
                        end, ', ' order by c.ordinal_position)
        into v_cols, v_sel
      from information_schema.columns c
      where c.table_schema = 'qa' and c.table_name = t
        and c.is_generated = 'NEVER'
        and not (t = 'audit_log' and c.column_name = 'id')
        and exists (select 1 from information_schema.columns p
                    where p.table_schema = 'prod' and p.table_name = t and p.column_name = c.column_name);
      execute format('insert into qa.%I (%s) select %s from prod.%I where ministry_id = any($1)', t, v_cols, v_sel, t)
        using p_ministries;
    end loop;

    -- 5. Put back the QA-only access the Church Admin ticked, and remember
    --    the ticks for next time.
    delete from qa.refresh_keep_list where ministry_id = any(p_ministries);
    for k in
      select distinct x.ministry_id, x.user_id, x.role, coalesce(x.group_name, '') as group_name
      from jsonb_to_recordset(coalesce(p_keep, '[]'::jsonb)) as x(ministry_id text, user_id uuid, role text, group_name text)
      where x.ministry_id = any(p_ministries)
    loop
      insert into qa.refresh_keep_list (ministry_id, user_id, role, group_name)
        values (k.ministry_id, k.user_id, k.role, k.group_name) on conflict do nothing;
      if not exists (select 1 from qa.profiles p where p.ministry_id = k.ministry_id and p.id = k.user_id) then
        insert into qa.profiles select * from qa_refresh_backup.profiles b where b.ministry_id = k.ministry_id and b.id = k.user_id;
      end if;
      if not exists (select 1 from qa.profiles p where p.ministry_id = k.ministry_id and p.id = k.user_id) then
        v_failed := v_failed || jsonb_build_object('ministry_id', k.ministry_id, 'user_id', k.user_id, 'role', k.role,
          'group_name', k.group_name, 'reason', 'no profile to restore');
        continue;
      end if;
      v_group := null;
      if k.group_name <> '' then
        select g.id into v_group from qa.groups g
        where g.ministry_id = k.ministry_id and g.name = k.group_name and not g.is_archived
        order by g.ladder_position limit 1;
        if v_group is null then
          v_failed := v_failed || jsonb_build_object('ministry_id', k.ministry_id, 'user_id', k.user_id, 'role', k.role,
            'group_name', k.group_name, 'reason', 'group not found in production');
          continue;
        end if;
      end if;
      insert into qa.user_roles (ministry_id, user_id, role, group_id)
        values (k.ministry_id, k.user_id, k.role::qa.app_role, v_group) on conflict do nothing;
      v_applied := v_applied || jsonb_build_object('ministry_id', k.ministry_id, 'user_id', k.user_id, 'role', k.role,
        'group_name', k.group_name);
    end loop;

    alter table qa.attendance_records enable trigger trg_attendance_update_join_date;
    alter table qa.outreach_entries enable trigger trg_outreach_clear_new_assignment;
    alter table qa.user_roles enable trigger trg_ensure_servant_for_sub_coordinator;

    -- 6. Counts after.
    foreach t in array c_insert loop
      execute format('select count(*) from qa.%I where ministry_id = any($1)', t) using p_ministries into n_after;
      v_tables := jsonb_set(v_tables, array[t, 'after'], to_jsonb(n_after));
    end loop;

    v_report := jsonb_build_object(
      'ministries', to_jsonb(p_ministries), 'dry_run', p_dry_run, 'tables', v_tables,
      'kept_applied', v_applied, 'kept_failed', v_failed,
      'backup', case when p_dry_run then null else 'qa_refresh_backup' end,
      'seconds', round(extract(epoch from clock_timestamp() - v_start)::numeric, 2));

    if p_dry_run then
      raise exception 'REFRESH_DRY_RUN_UNDO';
    end if;
  exception when others then
    if sqlerrm <> 'REFRESH_DRY_RUN_UNDO' then
      raise;
    end if;
    -- Dry run: everything in the block above was undone; v_report survives.
  end;

  insert into qa.refresh_log (run_by, ministries, dry_run, report) values (auth.uid(), p_ministries, p_dry_run, v_report);
  return v_report;
end
$$;

revoke all on function refresh_prod_ministries() from public, anon;
revoke all on function refresh_qa_only_access(text[]) from public, anon;
revoke all on function refresh_from_prod(text[], jsonb, boolean) from public, anon;
grant execute on function refresh_prod_ministries() to authenticated, service_role;
grant execute on function refresh_qa_only_access(text[]) to authenticated, service_role;
grant execute on function refresh_from_prod(text[], jsonb, boolean) to authenticated, service_role;
