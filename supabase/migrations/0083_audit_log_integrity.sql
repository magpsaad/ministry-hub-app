-- 0083_audit_log_integrity.sql -- AUDIT ENTRIES CAN'T BE FORGED (security audit #4;
-- owner-approved 4 Oct 2026). Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0083_audit_log_integrity.sql; commit;
-- Undo with 0083_down_audit_log_integrity.sql.
--
-- Before: anyone with a role could add an audit entry under ANYONE's name
-- (any user_id), dated whenever they liked, of any type.
-- * An entry a signed-in person adds must name THEM as its author.
-- * Its time is always "now", set by the database (no backdating). Work done
--   directly in the database (no signed-in user) keeps the time it gives.
-- * The check-in types (CHECKIN_REGISTRATION, CHECKIN_SIGNUP_ALERT) are
--   written only by the database itself (0080), never by a person.
-- * Entries still can't be edited or deleted by anyone (no such rules exist);
--   only the Admin archive tool (archive_audit_log) removes old ones.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log for insert
  with check (
    ministry_id = (select current_ministry_id())
    and (select is_app_user())
    and user_id = (select auth.uid())
    and action_type not in ('CHECKIN_REGISTRATION', 'CHECKIN_SIGNUP_ALERT')
  );

create or replace function audit_log_stamp_time()
returns trigger language plpgsql security definer as $$
begin
  if auth.uid() is not null then
    new.occurred_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_audit_log_stamp_time on audit_log;
create trigger trg_audit_log_stamp_time
  before insert on audit_log
  for each row execute function audit_log_stamp_time();

do $$
begin
  execute format('alter function audit_log_stamp_time() set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function audit_log_stamp_time() from public, anon, authenticated';
end
$$;
