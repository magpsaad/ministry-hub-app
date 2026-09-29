-- 0064_down_project_b_expand.sql -- ROLLBACK of 0064 (MULTI_TENANT_PLAN.md §13).
-- Puts the schema back exactly as it was, using the snapshot B1_backup.sql
-- took, then checks itself against that snapshot and aborts (undoing
-- everything) if anything differs. Run only if needed:
--     begin; set local search_path to qa; \i 0064_down_project_b_expand.sql; commit;
-- If the later Project B steps were applied, undo them first, in this order:
-- 0066_down, then 0065_down, then this file.
--
-- Refuses to run once any ministry other than SAY has data (rolling back
-- would merge different ministries' rows together).

do $$
declare
  s text := current_schema();
  b text := current_schema() || '_premm_backup';
  t text;
  r record;
  v_bad text;
  v_tables text[] := array[
    'app_settings', 'groups', 'members', 'universities', 'attendance_records', 'outreach_entries',
    'service_calendar_events', 'holiday_rules', 'verses', 'qr_codes', 'pending_servants',
    'pending_servant_attendance', 'audit_log', 'audit_config', 'actions_needed_config', 'user_roles', 'profiles'];
begin
  -- 0. Preconditions.
  if s not in ('qa', 'prod') then raise exception 'Run with search_path set to qa or prod (got %)', s; end if;
  if to_regclass(s || '.ministries') is null then raise exception '0064 is not applied in %', s; end if;
  if to_regnamespace(b) is null then raise exception 'Backup schema % not found -- cannot roll back safely', b; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage'
             and (coalesce(qual, '') || coalesce(with_check, '')) like '%storage_write_allowed%') then
    raise exception 'Storage rules still use storage_write_allowed -- run 0065_down first';
  end if;
  if (select default_ministry_id from tenancy_settings limit 1) is null then
    raise exception 'The contract step (0066) is applied -- run 0066_down first';
  end if;
  foreach t in array v_tables loop
    execute format('select %L from %I where ministry_id <> %L limit 1', t, t, 'SAY') into v_bad;
    if v_bad is not null then
      raise exception 'Table % has rows for a ministry other than SAY -- a rollback would mix ministries', t;
    end if;
  end loop;

  -- 1. Drop the new security rules.
  for r in select tablename, policyname from pg_policies where schemaname = s loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;

  -- 2. Drop the ministry columns (this also drops every key, index and
  --    cross-ministry link built on them).
  foreach t in array v_tables loop
    execute format('alter table %I drop column ministry_id cascade', t);
  end loop;
  alter table app_settings drop column sub_coordinator_auto_servant;

  -- 3. Drop the new tables.
  drop table ministry_addresses, church_admins, tenancy_settings, ministries;

  -- 4. Drop functions that did not exist before, and the one whose result
  --    shape changed (recreated from the snapshot in step 6).
  for r in execute format(
    'select p.oid::regprocedure::text as sig from pg_proc p
     where p.pronamespace = %L::regnamespace
       and (p.oid::regprocedure::text not in (select sig from %I.catalog_functions) or p.proname = %L)',
    s, b, 'checkin_get_flow')
  loop
    execute format('drop function %s', r.sig);
  end loop;

  -- 5. Recreate the constraints and indexes that 0064 dropped (keys and
  --    unique constraints before the foreign keys that need them).
  for r in execute format(
    'select c.relname, c.conname, c.def from %I.catalog_constraints c
     where not exists (select 1 from pg_constraint k join pg_class t on t.oid = k.conrelid
                       where k.connamespace = %L::regnamespace and t.relname = c.relname and k.conname = c.conname)
     order by case c.contype when %L then 1 when %L then 2 when %L then 3 else 4 end, c.relname, c.conname',
    b, s, 'p', 'u', 'c')
  loop
    execute format('alter table %I add constraint %I %s', r.relname, r.conname, r.def);
  end loop;

  for r in execute format(
    'select i.indexdef from %I.catalog_indexes i
     where not exists (select 1 from pg_indexes x where x.schemaname = %L and x.indexname = i.indexname)',
    b, s)
  loop
    execute r.indexdef;
  end loop;

  -- 6. Restore every function exactly as it was (definition, settings).
  for r in execute format('select def from %I.catalog_functions', b) loop
    execute r.def;
  end loop;

  -- 7. Restore function permissions exactly as they were.
  for r in execute format('select sig from %I.catalog_functions', b) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
  for r in execute format('select sig, rolname from %I.catalog_function_grants', b) loop
    execute format('grant execute on function %s to %I', r.sig, r.rolname);
  end loop;

  -- 8. Restore the security rules exactly as they were.
  for r in execute format('select * from %I.catalog_policies', b) loop
    execute format('create policy %I on %I as %s for %s to %s%s%s',
      r.policyname, r.tablename, r.permissive, r.cmd, array_to_string(r.roles, ', '),
      case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
  end loop;

  -- 9. Self-check against the snapshot; any difference aborts the rollback.
  execute format(
    'select string_agg(x, %L) from (
       (select sig || %L as x from %I.catalog_functions f
        where not exists (select 1 from pg_proc p where p.pronamespace = %L::regnamespace
                          and p.oid::regprocedure::text = f.sig and pg_get_functiondef(p.oid) = f.def))
       union all
       (select %L || p.oid::regprocedure::text from pg_proc p where p.pronamespace = %L::regnamespace
          and p.oid::regprocedure::text not in (select sig from %I.catalog_functions))
     ) d', ', ', ' (definition differs)', b, s, 'extra function ', s, b) into v_bad;
  if v_bad is not null then raise exception 'Rollback check failed -- functions: %', v_bad; end if;

  execute format(
    'select string_agg(tablename || %L || policyname, %L) from (
       (select tablename, policyname, cmd, qual, with_check from %I.catalog_policies
        except select tablename::text, policyname::text, cmd, qual, with_check from pg_policies where schemaname = %L)
       union all
       (select tablename::text, policyname::text, cmd, qual, with_check from pg_policies where schemaname = %L
        except select tablename, policyname, cmd, qual, with_check from %I.catalog_policies)
     ) d', '.', ', ', b, s, s, b) into v_bad;
  if v_bad is not null then raise exception 'Rollback check failed -- security rules: %', v_bad; end if;

  execute format(
    'select string_agg(relname || %L || conname, %L) from (
       (select relname, conname, def from %I.catalog_constraints
        except select t.relname::text, k.conname::text, pg_get_constraintdef(k.oid)
               from pg_constraint k join pg_class t on t.oid = k.conrelid where k.connamespace = %L::regnamespace)
       union all
       (select t.relname::text, k.conname::text, pg_get_constraintdef(k.oid)
        from pg_constraint k join pg_class t on t.oid = k.conrelid where k.connamespace = %L::regnamespace
        except select relname, conname, def from %I.catalog_constraints)
     ) d', '.', ', ', b, s, s, b) into v_bad;
  if v_bad is not null then raise exception 'Rollback check failed -- constraints: %', v_bad; end if;

  execute format(
    'select string_agg(indexname, %L) from (
       (select indexname, indexdef from %I.catalog_indexes
        except select indexname::text, indexdef from pg_indexes where schemaname = %L)
       union all
       (select indexname::text, indexdef from pg_indexes where schemaname = %L
        except select indexname, indexdef from %I.catalog_indexes)
     ) d', ', ', b, s, s, b) into v_bad;
  if v_bad is not null then raise exception 'Rollback check failed -- indexes: %', v_bad; end if;

  execute format(
    'select string_agg(table_name || %L || column_name, %L) from (
       (select table_name, column_name, data_type, is_nullable, column_default from %I.catalog_columns
        except select table_name::text, column_name::text, data_type::text, is_nullable::text, column_default
               from information_schema.columns where table_schema = %L)
       union all
       (select table_name::text, column_name::text, data_type::text, is_nullable::text, column_default
        from information_schema.columns where table_schema = %L
        except select table_name, column_name, data_type, is_nullable, column_default from %I.catalog_columns)
     ) d', '.', ', ', b, s, s, b) into v_bad;
  if v_bad is not null then raise exception 'Rollback check failed -- columns: %', v_bad; end if;
end
$$;

notify pgrst, 'reload schema';
