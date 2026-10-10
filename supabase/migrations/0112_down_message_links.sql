-- 0112_down_message_links.sql -- undo 0112 (message links are dropped).
--     begin; set local search_path to qa; \i 0112_down_message_links.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

do $$
declare v text;
begin
  v := pg_get_functiondef('send_message(uuid[], uuid[], text, text, boolean, date, text, text)'::regprocedure);
  v := replace(v, ', p_link text DEFAULT NULL::text)', ')');
  v := regexp_replace(v, E'\\n  if nullif\\(btrim\\(coalesce\\(p_link.*?raise exception ''The link must start with https://'';\\n  end if;', '', 's');
  v := replace(v, 'mode, batch_id, link_url)', 'mode, batch_id)');
  v := replace(v, E'v_batch, nullif(btrim(coalesce(p_link, '''')), ''''))', 'v_batch)');
  drop function send_message(uuid[], uuid[], text, text, boolean, date, text, text);
  execute v;

  v := pg_get_functiondef('get_conversation(uuid)'::regprocedure);
  execute replace(v, '''batch_id'', c.batch_id, ''link_url'', c.link_url,', '''batch_id'', c.batch_id,');
end
$$;

revoke all on function send_message(uuid[], uuid[], text, text, boolean, date, text) from public, anon;
grant execute on function send_message(uuid[], uuid[], text, text, boolean, date, text) to authenticated, service_role;

alter table conversations drop column if exists link_url;
