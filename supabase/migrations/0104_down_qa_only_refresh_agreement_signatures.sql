-- 0104_down_qa_only_refresh_agreement_signatures.sql -- QA ONLY: refresh_from_prod
-- stops copying the agreement signatures (takes out 0104's step). The
-- signatures already copied stay; delete them by hand if wanted.
--     begin; set local search_path to qa; \i 0104_down_qa_only_refresh_agreement_signatures.sql; commit;

do $$
declare
  v_def text;
  v_start int;
  v_end int;
  c_first constant text := E'    -- 0104: the Confidentiality Agreement signatures';
  c_last constant text := E'jsonb_build_object(''added'', n_after));\n\n';
begin
  if current_schema() <> 'qa' then
    raise exception 'QA only: run with search_path set to qa (got %)', current_schema();
  end if;
  v_def := pg_get_functiondef('qa.refresh_from_prod(text[], jsonb, boolean)'::regprocedure);
  v_start := position(c_first in v_def);
  v_end := position(c_last in v_def);
  if v_start = 0 or v_end = 0 then
    raise exception 'refresh_from_prod has no 0104 step';
  end if;
  execute left(v_def, v_start - 1) || substr(v_def, v_end + length(c_last));
end
$$;
