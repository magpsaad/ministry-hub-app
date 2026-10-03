-- 0074_down_checkin_hardening.sql -- undoes 0074: drops its new functions and
-- columns and restores every changed or dropped check-in function exactly
-- (definition and access) from <schema>_premm_backup.fn_backup_0074.
-- Deploy the matching app code first, or the check-in page breaks.
--     begin; set local search_path to qa; \i 0074_down_checkin_hardening.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  if to_regclass(current_schema() || '_premm_backup.fn_backup_0074') is null then
    raise exception 'No 0074 backup found';
  end if;
end
$$;

drop function if exists checkin_window(uuid);
drop function if exists checkin_search_members(uuid, text);
drop function if exists checkin_search_servants(uuid, text);
drop function if exists checkin_get_member(uuid, uuid);
drop function if exists checkin_get_servant(uuid, uuid, text);
drop function if exists checkin_find_possible_duplicate_member(uuid, text, text, text);
drop function if exists checkin_resolve_duplicate_member(uuid, text, text, text, uuid, text, date, text, text, text, boolean);

do $$
declare r record; b text := current_schema() || '_premm_backup';
begin
  for r in execute format('select sig, def, acl from %I.fn_backup_0074', b) loop
    execute r.def;
    execute format('revoke all on function %s from public', r.sig);
    if r.acl like '%anon=X%' then execute format('grant execute on function %s to anon', r.sig); end if;
    if r.acl like '%authenticated=X%' then execute format('grant execute on function %s to authenticated', r.sig); end if;
    if r.acl like '%service_role=X%' then execute format('grant execute on function %s to service_role', r.sig); end if;
  end loop;
end
$$;

drop function if exists checkin_match_member(text, text, text, text);
drop function if exists checkin_search_text(text);
drop function if exists checkin_short_name(text, boolean);
drop function if exists checkin_is_open(text);
alter table app_settings drop column if exists checkin_closes_at;
alter table app_settings drop column if exists checkin_opens_at;
