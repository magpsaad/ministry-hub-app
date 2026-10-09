-- 0104_qa_only_refresh_agreement_signatures.sql -- QA ONLY. Never run with search_path prod.
--     begin; set local search_path to qa; \i 0104_qa_only_refresh_agreement_signatures.sql; commit;
--
-- Owner-reported (9 Oct 2026): after "Refresh QA from production", the
-- servants who signed the Confidentiality Agreement in production showed as
-- not signed in QA. refresh_from_prod (0068) predates the agreement (0088)
-- and never copied agreement_signatures. It now does: production's
-- signatures for the refreshed ministries are added to QA, with the version
-- matched by its NUMBER (QA's and production's agreement_versions ids
-- differ: version 2 is id 2 in production, id 4 in QA). QA's own test
-- signatures are kept; one already in QA (same person, ministry, version)
-- isn't added twice. agreement_grace isn't per ministry, so it's left alone.
--
-- Patches the live function by inserting one step before the keep-list step
-- (refuses to run if that step isn't found, or if it's already patched).
-- Also adds those signatures to the ministries refreshed so far, once.
-- Undo: 0104_down_qa_only_refresh_agreement_signatures.sql.

do $$
declare
  v_def text;
  c_marker constant text := E'    delete from qa.refresh_keep_list where ministry_id = any(p_ministries);\n';
  c_step constant text := E'    -- 0104: the Confidentiality Agreement signatures (versions matched by\n'
    || E'    -- number; QA''s own test signatures are kept).\n'
    || E'    insert into qa.agreement_signatures (user_id, version_id, typed_name, email, signed_at, ministry_id)\n'
    || E'    select s.user_id, qv.id, s.typed_name, s.email, s.signed_at, s.ministry_id\n'
    || E'    from prod.agreement_signatures s\n'
    || E'    join prod.agreement_versions pv on pv.id = s.version_id\n'
    || E'    join qa.agreement_versions qv on qv.version = pv.version\n'
    || E'    where s.ministry_id = any(p_ministries)\n'
    || E'      and not exists (select 1 from qa.agreement_signatures q\n'
    || E'                      where q.user_id = s.user_id and q.ministry_id = s.ministry_id and q.version_id = qv.id);\n'
    || E'    get diagnostics n_after = row_count;\n'
    || E'    v_tables := v_tables || jsonb_build_object(''agreement_signatures'', jsonb_build_object(''added'', n_after));\n\n';
begin
  if current_schema() <> 'qa' then
    raise exception 'QA only: run with search_path set to qa (got %)', current_schema();
  end if;
  v_def := pg_get_functiondef('qa.refresh_from_prod(text[], jsonb, boolean)'::regprocedure);
  if position('qa.agreement_signatures' in v_def) > 0 then
    raise exception 'refresh_from_prod already copies agreement signatures';
  end if;
  if position(c_marker in v_def) = 0 then
    raise exception 'refresh_from_prod has changed since 0068; patch it by hand';
  end if;
  execute replace(v_def, c_marker, c_step || c_marker);

  -- Once: the ministries already refreshed from production.
  insert into qa.agreement_signatures (user_id, version_id, typed_name, email, signed_at, ministry_id)
  select s.user_id, qv.id, s.typed_name, s.email, s.signed_at, s.ministry_id
  from prod.agreement_signatures s
  join prod.agreement_versions pv on pv.id = s.version_id
  join qa.agreement_versions qv on qv.version = pv.version
  where s.ministry_id in (select distinct unnest(l.ministries) from qa.refresh_log l where not l.dry_run)
    and exists (select 1 from qa.profiles p where p.ministry_id = s.ministry_id and p.id = s.user_id)
    and not exists (select 1 from qa.agreement_signatures q
                    where q.user_id = s.user_id and q.ministry_id = s.ministry_id and q.version_id = qv.id);
end
$$;
