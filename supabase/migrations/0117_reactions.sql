-- 0117_reactions.sql -- EMOJI REACTIONS (owner-approved 15 Oct 2026) on
-- announcements and on messages. One reaction per person per item, like
-- WhatsApp: picking another emoji replaces it, picking the same one again
-- removes it. A fixed set of six: 👍 ❤️ 🙏 😂 😮 😢. No notifications.
--
-- * reactions: one row per person per item.
-- * reaction_ministry(): may this person see (or, p_write, add to) the
--   item? Announcements: the people it's for, its author, Admins and GCs
--   (the same people who see it on the Announcements page). Messages: the
--   conversation's members; someone who only oversees conversations sees
--   reactions but can't add one.
-- * set_reaction(kind, id, emoji): set, replace, or (null) remove mine.
-- * item_reactions(kind, ids): per item and emoji, how many, whether one is
--   mine, and who (for the picker's "who reacted" list).
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0117_reactions.sql; commit;
-- Undo with 0117_down_reactions.sql. Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create table if not exists reactions (
  ministry_id text not null references ministries(id),
  kind text not null check (kind in ('announcement', 'message')),
  item_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '🙏', '😂', '😮', '😢')),
  created_at timestamptz not null default now(),
  primary key (kind, item_id, user_id)
);
create index if not exists reactions_item_idx on reactions (kind, item_id);
alter table reactions enable row level security;
revoke all on reactions from anon, authenticated;
grant all on reactions to service_role;

create or replace function reaction_ministry(p_kind text, p_id uuid, p_uid uuid, p_write boolean)
returns text language plpgsql stable security definer as $$
declare v_m text := current_ministry_id(); v_ok boolean;
begin
  if p_uid is null or v_m is null then
    return null;
  end if;
  if p_kind = 'announcement' then
    select announcement_is_for(a.id, p_uid) or a.author_id = p_uid or coalesce(is_admin_or_gc_in(v_m, p_uid), false)
      into v_ok
    from announcements a where a.id = p_id and a.ministry_id = v_m;
  elsif p_kind = 'message' then
    select message_is_member(c.id, p_uid) or (not p_write and message_oversees(c.ministry_id, p_uid))
      into v_ok
    from messages x join conversations c on c.id = x.conversation_id
    where x.id = p_id and c.ministry_id = v_m;
  end if;
  return case when coalesce(v_ok, false) then v_m end;
end
$$;

create or replace function set_reaction(p_kind text, p_id uuid, p_emoji text)
returns void language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_m text;
begin
  if v_uid is null then
    raise exception 'Please sign in again';
  end if;
  v_m := reaction_ministry(p_kind, p_id, v_uid, true);
  if v_m is null then
    raise exception 'You can''t react to this';
  end if;
  if p_emoji is null then
    delete from reactions where kind = p_kind and item_id = p_id and user_id = v_uid;
    return;
  end if;
  if p_emoji not in ('👍', '❤️', '🙏', '😂', '😮', '😢') then
    raise exception 'Choose one of the reactions shown';
  end if;
  insert into reactions (ministry_id, kind, item_id, user_id, emoji) values (v_m, p_kind, p_id, v_uid, p_emoji)
  on conflict (kind, item_id, user_id) do update set emoji = excluded.emoji, created_at = now();
end
$$;

create or replace function item_reactions(p_kind text, p_ids uuid[])
returns table (item_id uuid, emoji text, n integer, mine boolean, names text[])
language plpgsql stable security definer as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  return query
  with ok as (
    select distinct i from unnest(coalesce(p_ids[1:200], '{}')) i
    where reaction_ministry(p_kind, i, v_uid, false) is not null
  )
  select r.item_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid),
         array_agg(person_name(r.ministry_id, r.user_id) order by r.created_at)
  from reactions r join ok on ok.i = r.item_id
  where r.kind = p_kind
  group by r.item_id, r.emoji
  order by r.item_id, min(r.created_at);
end
$$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['set_reaction(text, uuid, text)', 'item_reactions(text, uuid[])'] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute format('alter function reaction_ministry(text, uuid, uuid, boolean) set search_path = %I, public, pg_temp', s);
  revoke all on function reaction_ministry(text, uuid, uuid, boolean) from public, anon, authenticated;
  grant execute on function reaction_ministry(text, uuid, uuid, boolean) to service_role;
end
$$;
