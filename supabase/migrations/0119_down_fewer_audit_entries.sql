-- 0119_down_fewer_audit_entries.sql -- undoes 0119: calendar changes and
-- agreement signatures are written to the audit log again.
--     begin; set local search_path to qa; \i 0119_down_fewer_audit_entries.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function calendar_events_audit()
returns trigger language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_row service_calendar_events;
  v_type audit_action_type;
  v_details jsonb;
  v_has_profile boolean;
begin
  if tg_op = 'INSERT' then v_row := new; v_type := 'CALENDAR_EVENT_CREATED';
  elsif tg_op = 'UPDATE' then v_row := new; v_type := 'CALENDAR_EVENT_UPDATED';
  else v_row := old; v_type := 'CALENDAR_EVENT_DELETED';
  end if;
  if tg_op = 'DELETE' then
    insert into calendar_events_deleted (id, ministry_id, event, deleted_by)
    values (old.id, old.ministry_id, to_jsonb(old), v_uid)
    on conflict (id) do update set event = excluded.event, deleted_at = now(), deleted_by = excluded.deleted_by;
    delete from calendar_events_deleted where deleted_at < now() - interval '30 days';
  end if;
  if v_uid is null then return null; end if;
  if not coalesce((select enabled from audit_config where ministry_id = v_row.ministry_id and action_type = v_type), true) then
    return null;
  end if;
  v_details := jsonb_build_object('eventId', v_row.id, 'title', v_row.title, 'start_date', v_row.start_date);
  if tg_op = 'UPDATE' then
    v_details := v_details || jsonb_build_object('changed',
      (select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', to_jsonb(old) -> n.key, 'to', n.value)), '{}'::jsonb)
       from jsonb_each(to_jsonb(new)) n where to_jsonb(old) -> n.key is distinct from n.value));
  end if;
  if tg_op = 'INSERT' and current_setting('app.calendar_restore', true) = 'on' then
    v_details := v_details || jsonb_build_object('restored', true);
  end if;
  v_has_profile := exists (select 1 from profiles where id = v_uid and ministry_id = v_row.ministry_id);
  if not v_has_profile then
    v_details := v_details || jsonb_build_object('user_id', v_uid);
  end if;
  insert into audit_log (ministry_id, user_id, action_type, details)
  values (v_row.ministry_id, case when v_has_profile then v_uid end, v_type, v_details);
  return null;
end
$$;
drop trigger if exists trg_calendar_events_audit on service_calendar_events;
create trigger trg_calendar_events_audit after insert or update or delete on service_calendar_events
  for each row execute function calendar_events_audit();

do $$
declare v text; a text; b text;
begin
  v := pg_get_functiondef('sign_agreement(integer, text)'::regprocedure);
  a := E'  returning id into v_id;\n\n  return v_id;';
  b := E'  returning id into v_id;\n\n'
    || E'  -- A new servant has no profile here yet (they register after signing).\n'
    || E'  if v_m is not null and exists (select 1 from profiles p where p.ministry_id = v_m and p.id = v_uid) then\n'
    || E'    insert into audit_log (ministry_id, user_id, action_type, details)\n'
    || E'    values (v_m, v_uid, ''AGREEMENT_SIGNED'',\n'
    || E'            jsonb_build_object(''version'', (select version from agreement_versions where id = v_cur),\n'
    || E'                               ''signatureId'', v_id, ''typedName'', v_name));\n'
    || E'  end if;\n'
    || E'  return v_id;';
  if position(a in v) = 0 then
    raise exception 'sign_agreement has changed; restore it by hand';
  end if;
  execute replace(v, a, b);
end
$$;

do $$
declare s text := current_schema();
begin
  execute format('alter function calendar_events_audit() set search_path = %I, public, pg_temp', s);
  revoke all on function calendar_events_audit() from public, anon, authenticated;
end
$$;
