-- 0119_fewer_audit_entries.sql -- FEWER AUDIT LOG ENTRIES (owner-requested
-- 17 Oct 2026). The audit log keeps only: opening the app, role and access
-- changes, deletions, group transitions (with their archiving) and the
-- check-in sign-up alerts. The database's own entries for calendar changes
-- and agreement signatures stop (agreement signatures are kept in
-- agreement_signatures anyway). Past entries are left as they are.
--
-- * calendar_events_audit(): now only keeps a deleted event for the 30-day
--   restore (calendar_events_deleted); the trigger fires on delete only.
-- * sign_agreement(): no AGREEMENT_SIGNED audit entry.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0119_fewer_audit_entries.sql; commit;
-- Undo with 0119_down_fewer_audit_entries.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function calendar_events_audit()
returns trigger language plpgsql security definer as $$
begin
  -- Kept for Calendar Maintenance's 30-day restore of a deleted event.
  if tg_op = 'DELETE' then
    insert into calendar_events_deleted (id, ministry_id, event, deleted_by)
    values (old.id, old.ministry_id, to_jsonb(old), auth.uid())
    on conflict (id) do update set event = excluded.event, deleted_at = now(), deleted_by = excluded.deleted_by;
    delete from calendar_events_deleted where deleted_at < now() - interval '30 days';
  end if;
  return null;
end
$$;
drop trigger if exists trg_calendar_events_audit on service_calendar_events;
create trigger trg_calendar_events_audit after delete on service_calendar_events
  for each row execute function calendar_events_audit();

do $$
declare v text; a text;
begin
  v := pg_get_functiondef('sign_agreement(integer, text)'::regprocedure);
  a := E'  -- A new servant has no profile here yet (they register after signing).\n'
    || E'  if v_m is not null and exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid) then\n'
    || E'    insert into audit_log (ministry_id, user_id, action_type, details)\n'
    || E'    values (v_m, v_uid, ''AGREEMENT_SIGNED'',\n'
    || E'            jsonb_build_object(''version'', (select version from agreement_versions where id = v_cur),\n'
    || E'                               ''signatureId'', v_id, ''typedName'', v_name));\n'
    || E'  end if;\n';
  if position(a in v) = 0 then
    raise exception 'sign_agreement has changed; patch it by hand';
  end if;
  execute replace(v, a, '');
end
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function calendar_events_audit() set search_path = %I, public, pg_temp', s);
  revoke all on function calendar_events_audit() from public, anon, authenticated;
end
$$;
