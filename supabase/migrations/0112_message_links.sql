-- 0112_message_links.sql -- A LINK ON A NEW MESSAGE (owner-requested
-- 10 Oct 2026), like announcements: optional, must start with http(s)://,
-- kept on the conversation and shown under its subject as "Open link".
-- send_message gains p_link (default null, so a call without it still
-- works); get_conversation returns link_url.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0112_message_links.sql; commit;
-- Undo with 0112_down_message_links.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table conversations add column if not exists link_url text;

do $$
declare v text;
begin
  -- send_message: new p_link argument, checked like an announcement's link.
  v := pg_get_functiondef('send_message(uuid[], uuid[], text, text, boolean, date, text)'::regprocedure);
  if position('p_mode text)' in v) = 0
     or (length(v) - length(replace(v, 'mode, batch_id)', ''))) / length('mode, batch_id)') <> 2
     or position(E'raise exception ''The message is too long (4,000 characters at most).''; end if;' in v) = 0 then
    raise exception 'send_message has changed; patch it by hand';
  end if;
  v := replace(v, 'p_mode text)', 'p_mode text, p_link text DEFAULT NULL::text)');
  v := replace(v, E'raise exception ''The message is too long (4,000 characters at most).''; end if;',
    E'raise exception ''The message is too long (4,000 characters at most).''; end if;\n'
    || E'  if nullif(btrim(coalesce(p_link, '''')), '''') is not null\n'
    || E'     and (btrim(p_link) !~ ''^https?://'' or char_length(btrim(p_link)) > 2000) then\n'
    || E'    raise exception ''The link must start with https://'';\n'
    || E'  end if;');
  v := replace(v, 'mode, batch_id)', 'mode, batch_id, link_url)');
  v := regexp_replace(v, E'v_batch\\)(\\s*returning id into v_conv;)', E'v_batch, nullif(btrim(coalesce(p_link, '''')), ''''))\\1', 'g');
  if (length(v) - length(replace(v, 'nullif(btrim(coalesce(p_link', ''))) / length('nullif(btrim(coalesce(p_link') <> 3 then
    raise exception 'send_message: link not added everywhere';
  end if;
  drop function send_message(uuid[], uuid[], text, text, boolean, date, text);
  execute v;

  -- get_conversation: hand the link back.
  v := pg_get_functiondef('get_conversation(uuid)'::regprocedure);
  if position('''batch_id'', c.batch_id,' in v) = 0 then raise exception 'get_conversation has changed; patch it by hand'; end if;
  execute replace(v, '''batch_id'', c.batch_id,', '''batch_id'', c.batch_id, ''link_url'', c.link_url,');
end
$$;

revoke all on function send_message(uuid[], uuid[], text, text, boolean, date, text, text) from public, anon;
grant execute on function send_message(uuid[], uuid[], text, text, boolean, date, text, text) to authenticated, service_role;
