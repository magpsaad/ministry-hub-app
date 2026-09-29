-- B1_backup.sql -- Project B phase B1 (MULTI_TENANT_PLAN.md §11).
-- Run immediately BEFORE 0064, once per environment:
--     begin; set local search_path to qa; \i B1_backup.sql; commit;
--
-- Creates <schema>_premm_backup holding:
--   * a full copy of every app table (data safety net), and
--   * a snapshot of the schema's functions, their permissions, security
--     rules, constraints, indexes and columns -- which 0064_down replays to
--     put everything back exactly, and then checks itself against.
-- Readable by nobody but the database owner. This is IN ADDITION to the
-- pg_dump the owner takes before B1.

do $$
declare
  s text := current_schema();
  b text := current_schema() || '_premm_backup';
  t text;
begin
  if s not in ('qa', 'prod') then raise exception 'Run with search_path set to qa or prod (got %)', s; end if;
  if to_regnamespace(b) is not null then raise exception 'Backup schema % already exists', b; end if;
  if to_regclass(s || '.ministries') is not null then raise exception '% is already converted -- nothing to back up', s; end if;

  execute format('create schema %I', b);
  execute format('revoke all on schema %I from public, anon, authenticated', b);

  foreach t in array array[
    'actions_needed_config', 'app_releases', 'app_settings', 'attendance_records', 'audit_config', 'audit_log',
    'groups', 'holiday_rules', 'members', 'outreach_entries', 'pending_servant_attendance', 'pending_servants',
    'profiles', 'qr_codes', 'service_calendar_events', 'universities', 'user_roles', 'verses'
  ] loop
    execute format('create table %I.%I as table %I.%I', b, t, s, t);
  end loop;

  execute format($q$create table %1$I.catalog_functions as
    select p.oid::regprocedure::text as sig, p.proname::text as proname, pg_get_functiondef(p.oid) as def
    from pg_proc p where p.pronamespace = %2$L::regnamespace$q$, b, s);

  execute format($q$create table %1$I.catalog_function_grants as
    select p.oid::regprocedure::text as sig, r.rolname::text as rolname
    from pg_proc p cross join pg_roles r
    where p.pronamespace = %2$L::regnamespace and r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, p.oid, 'execute')$q$, b, s);

  execute format($q$create table %1$I.catalog_policies as
    select tablename::text, policyname::text, permissive, cmd, roles::text[] as roles, qual, with_check
    from pg_policies where schemaname = %2$L$q$, b, s);

  execute format($q$create table %1$I.catalog_constraints as
    select c.relname::text as relname, k.conname::text as conname, k.contype::text as contype, pg_get_constraintdef(k.oid) as def
    from pg_constraint k join pg_class c on c.oid = k.conrelid
    where k.connamespace = %2$L::regnamespace$q$, b, s);

  execute format($q$create table %1$I.catalog_indexes as
    select tablename::text, indexname::text, indexdef from pg_indexes where schemaname = %2$L$q$, b, s);

  execute format($q$create table %1$I.catalog_columns as
    select table_name::text, column_name::text, ordinal_position, data_type::text, is_nullable::text, column_default
    from information_schema.columns where table_schema = %2$L$q$, b, s);

  execute format('revoke all on all tables in schema %I from public, anon, authenticated', b);
end
$$;
