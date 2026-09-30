-- 0068_down_qa_only_refresh_from_prod.sql -- QA ONLY. Removes the "Refresh QA
-- from production" functions and their bookkeeping tables. Leaves the last
-- qa_refresh_backup schema (if any) in place; drop it by hand when unneeded.
--     begin; set local search_path to qa; \i 0068_down_qa_only_refresh_from_prod.sql; commit;

do $$
begin
  if current_schema() <> 'qa' then
    raise exception 'QA only: run with search_path set to qa (got %)', current_schema();
  end if;
end
$$;

drop function if exists refresh_from_prod(text[], jsonb, boolean);
drop function if exists refresh_qa_only_access(text[]);
drop function if exists refresh_prod_ministries();
drop table if exists refresh_log;
drop table if exists refresh_keep_list;
