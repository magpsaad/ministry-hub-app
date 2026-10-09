-- 0102_messaging.sql -- MESSAGES AND TASKS (owner-approved design, 8 Oct 2026)
--
-- * Anyone in a ministry can message anyone else there, or a whole class
--   (its Servants). Several recipients: either each replies privately to the
--   sender (one conversation per person, sharing a batch_id so the sender
--   sees them together) or one group conversation.
-- * A message can be a task, with an optional due date; each recipient
--   marks it done with an optional note (and can reopen it). Back-and-forth
--   replies either way.
-- * Who else can read conversations is a ministry setting
--   (app_settings.message_oversight): 'gc' (General Coordinators, default),
--   'gc_admin' (GCs and System Admins) or 'none'. They read; they don't post
--   unless they're in the conversation.
-- * Messages can be edited by their author for 15 minutes; never deleted.
-- * Phone notifications: 'message' (new message, reply, or a task you gave
--   marked done) and 'task_due' (9 AM the day before it's due, if not done);
--   both start ON; sent to each person's own devices, honouring My Settings.
--   Messages go out straight away (like a text); 'task_due' only in the day.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0102_messaging.sql; commit;
-- Undo with 0102_down_messaging.sql.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings add column if not exists message_oversight text not null default 'gc';
alter table app_settings drop constraint if exists app_settings_message_oversight_check;
alter table app_settings add constraint app_settings_message_oversight_check
  check (message_oversight in ('gc', 'gc_admin', 'none'));

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  ministry_id text not null references ministries(id),
  created_by uuid not null,
  subject text not null check (char_length(btrim(subject)) between 1 and 120),
  is_task boolean not null default false,
  due_on date,
  mode text not null check (mode in ('direct', 'group')),
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check (due_on is null or is_task)
);
create index if not exists conversations_ministry_idx on conversations (ministry_id, last_message_at desc);
create index if not exists conversations_batch_idx on conversations (batch_id);
alter table conversations enable row level security;
revoke all on conversations from anon, authenticated;
grant all on conversations to service_role;

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null,
  is_sender boolean not null default false,
  last_read_at timestamptz,
  done_at timestamptz,
  done_note text check (done_note is null or char_length(done_note) <= 1000),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on conversation_members (user_id);
alter table conversation_members enable row level security;
revoke all on conversation_members from anon, authenticated;
grant all on conversation_members to service_role;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);
alter table messages enable row level security;
revoke all on messages from anon, authenticated;
grant all on messages to service_role;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function person_name(p_ministry text, p_user uuid)
returns text language sql stable security definer as $$
  select coalesce((select p.full_name from profiles p where p.ministry_id = p_ministry and p.id = p_user), 'Someone')
$$;

-- In this ministry, with a role, not deactivated.
create or replace function message_person_ok(p_ministry text, p_user uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles ur where ur.ministry_id = p_ministry and ur.user_id = p_user)
     and not exists (select 1 from profiles p where p.ministry_id = p_ministry and p.id = p_user and p.deactivated_at is not null)
$$;

-- May read every conversation here (the ministry's setting).
create or replace function message_oversees(p_ministry text, p_user uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce((select case s.message_oversight
                            when 'gc' then exists (select 1 from user_roles ur where ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role = 'general_coordinator')
                            when 'gc_admin' then exists (select 1 from user_roles ur where ur.ministry_id = p_ministry and ur.user_id = p_user and ur.role in ('general_coordinator', 'admin'))
                            else false end
                   from app_settings s where s.ministry_id = p_ministry), false)
     and aal2_ok(p_user)
$$;

create or replace function message_is_member(p_conv uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select exists (select 1 from conversation_members m where m.conversation_id = p_conv and m.user_id = p_user)
$$;

-- Tell the other people in a conversation (their own devices, if they want it).
create or replace function message_notify(p_conv uuid, p_from uuid, p_title text, p_body text)
returns void language plpgsql security definer as $$
declare c conversations; r record;
begin
  select * into c from conversations where id = p_conv;
  for r in select m.user_id from conversation_members m where m.conversation_id = p_conv and m.user_id <> p_from loop
    if notify_wants(c.ministry_id, r.user_id, 'message') then
      insert into notification_outbox (ministry_id, event, audience, target_user_id, title, body, url)
      values (c.ministry_id, 'message', 'person', r.user_id, left(p_title, 120), left(p_body, 160), '/messages/' || p_conv::text);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------
-- p_people: chosen people; p_classes: classes whose Servants are added.
-- p_mode: 'private' (each replies to me) or 'group' (one conversation).
create or replace function send_message(p_people uuid[], p_classes uuid[], p_subject text, p_body text,
                                        p_is_task boolean, p_due_on date, p_mode text)
returns uuid[] language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_m text := current_ministry_id();
  v_to uuid[];
  v_batch uuid := gen_random_uuid();
  v_conv uuid;
  v_ids uuid[] := '{}';
  v_r uuid;
  v_name text;
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) or not message_person_ok(v_m, v_uid) then
    raise exception 'Please sign in again';
  end if;
  if p_mode not in ('private', 'group') then raise exception 'Choose how replies work.'; end if;
  if char_length(btrim(coalesce(p_subject, ''))) = 0 then raise exception 'Add a subject.'; end if;
  if char_length(btrim(p_subject)) > 120 then raise exception 'The subject is too long (120 characters at most).'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message.'; end if;
  if char_length(btrim(p_body)) > 4000 then raise exception 'The message is too long (4,000 characters at most).'; end if;
  if p_due_on is not null and (not coalesce(p_is_task, false) or p_due_on < announcement_today(v_m)) then
    raise exception 'The due date must be today or later (and only for a task).';
  end if;
  if nullif(p_classes, '{}') is not null and exists (select 1 from unnest(p_classes) g
       where not exists (select 1 from groups x where x.id = g and x.ministry_id = v_m)) then
    raise exception 'Class not found';
  end if;
  select array_agg(distinct u) into v_to from (
    select unnest(coalesce(p_people, '{}')) u
    union
    select ur.user_id from user_roles ur where ur.ministry_id = v_m and ur.role = 'servant' and ur.group_id = any(coalesce(p_classes, '{}'))
  ) x where u <> v_uid and message_person_ok(v_m, u);
  if v_to is null or cardinality(v_to) = 0 then raise exception 'Choose who it''s to.'; end if;
  if cardinality(v_to) > 200 then raise exception 'That''s more than 200 people. Use an announcement instead.'; end if;
  v_name := notify_short(person_name(v_m, v_uid));

  if cardinality(v_to) = 1 or p_mode = 'group' then
    insert into conversations (ministry_id, created_by, subject, is_task, due_on, mode, batch_id)
    values (v_m, v_uid, btrim(p_subject), coalesce(p_is_task, false), p_due_on,
            case when cardinality(v_to) = 1 then 'direct' else 'group' end, v_batch)
    returning id into v_conv;
    insert into conversation_members (conversation_id, user_id, is_sender, last_read_at) values (v_conv, v_uid, true, now());
    insert into conversation_members (conversation_id, user_id) select v_conv, u from unnest(v_to) u;
    insert into messages (conversation_id, author_id, body) values (v_conv, v_uid, btrim(p_body));
    perform message_notify(v_conv, v_uid, case when p_is_task then 'New task: ' else '' end || btrim(p_subject), v_name || ': ' || btrim(p_body));
    v_ids := array[v_conv];
  else
    foreach v_r in array v_to loop
      insert into conversations (ministry_id, created_by, subject, is_task, due_on, mode, batch_id)
      values (v_m, v_uid, btrim(p_subject), coalesce(p_is_task, false), p_due_on, 'direct', v_batch)
      returning id into v_conv;
      insert into conversation_members (conversation_id, user_id, is_sender, last_read_at) values (v_conv, v_uid, true, now());
      insert into conversation_members (conversation_id, user_id) values (v_conv, v_r);
      insert into messages (conversation_id, author_id, body) values (v_conv, v_uid, btrim(p_body));
      perform message_notify(v_conv, v_uid, case when p_is_task then 'New task: ' else '' end || btrim(p_subject), v_name || ': ' || btrim(p_body));
      v_ids := v_ids || v_conv;
    end loop;
  end if;
  return v_ids;
end
$$;

create or replace function reply_message(p_conv uuid, p_body text)
returns uuid language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); c conversations; v_id uuid;
begin
  select * into c from conversations where id = p_conv;
  if c.id is null or not message_is_member(p_conv, v_uid) then raise exception 'Conversation not found'; end if;
  if not message_person_ok(c.ministry_id, v_uid) then raise exception 'Please sign in again'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message.'; end if;
  if char_length(btrim(p_body)) > 4000 then raise exception 'The message is too long (4,000 characters at most).'; end if;
  insert into messages (conversation_id, author_id, body) values (p_conv, v_uid, btrim(p_body)) returning id into v_id;
  update conversations set last_message_at = now() where id = p_conv;
  update conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = v_uid;
  perform message_notify(p_conv, v_uid, c.subject, notify_short(person_name(c.ministry_id, v_uid)) || ': ' || btrim(p_body));
  return v_id;
end
$$;

create or replace function edit_message(p_id uuid, p_body text)
returns boolean language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); msg messages;
begin
  select * into msg from messages where id = p_id;
  if msg.id is null or msg.author_id <> v_uid then raise exception 'Message not found'; end if;
  if msg.created_at < now() - interval '15 minutes' then raise exception 'Messages can only be edited for 15 minutes after sending.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message.'; end if;
  if char_length(btrim(p_body)) > 4000 then raise exception 'The message is too long (4,000 characters at most).'; end if;
  update messages set body = btrim(p_body), edited_at = now() where id = p_id;
  return true;
end
$$;

-- A task's recipient: done (with an optional note) or reopened.
create or replace function set_task_done(p_conv uuid, p_done boolean, p_note text)
returns boolean language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); c conversations; v_sender boolean;
begin
  select * into c from conversations where id = p_conv;
  select is_sender into v_sender from conversation_members where conversation_id = p_conv and user_id = v_uid;
  if c.id is null or v_sender is null then raise exception 'Conversation not found'; end if;
  if not c.is_task or v_sender then raise exception 'Only the people given a task can mark it done.'; end if;
  if char_length(btrim(coalesce(p_note, ''))) > 1000 then raise exception 'The note is too long (1,000 characters at most).'; end if;
  update conversation_members
     set done_at = case when p_done then now() end,
         done_note = case when p_done then nullif(btrim(coalesce(p_note, '')), '') end
   where conversation_id = p_conv and user_id = v_uid;
  if p_done then
    -- The person who gave the task hears about it.
    if notify_wants(c.ministry_id, c.created_by, 'message') then
      insert into notification_outbox (ministry_id, event, audience, target_user_id, title, body, url)
      values (c.ministry_id, 'message', 'person', c.created_by, 'Task done: ' || left(c.subject, 100),
              left(notify_short(person_name(c.ministry_id, v_uid)) || ' marked it done'
                   || coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '.'), 160),
              '/messages/' || p_conv::text);
    end if;
  end if;
  return p_done;
end
$$;

create or replace function mark_conversation_read(p_conv uuid)
returns void language sql security definer as $$
  update conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------
-- p_scope: 'mine' (conversations I'm in) or 'all' (everything, for those
-- who oversee messages).
create or replace function my_conversations(p_scope text)
returns table (id uuid, subject text, is_task boolean, due_on date, mode text, batch_id uuid, i_sent boolean,
               member boolean, people text, last_body text, last_author text, last_message_at timestamptz,
               unread boolean, my_done boolean, done_count integer, recipient_count integer)
language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then raise exception 'Please sign in again'; end if;
  if p_scope = 'all' and not message_oversees(v_m, v_uid) then raise exception 'You can''t see every conversation here.'; end if;
  return query
  select c.id, c.subject, c.is_task, c.due_on, c.mode, c.batch_id,
         c.created_by = v_uid,
         me.user_id is not null,
         (select string_agg(notify_short(person_name(v_m, m.user_id)), ', ' order by m.is_sender desc)
            from conversation_members m where m.conversation_id = c.id and m.user_id <> v_uid),
         lm.body, notify_short(person_name(v_m, lm.author_id)), c.last_message_at,
         me.user_id is not null and lm.author_id <> v_uid and (me.last_read_at is null or me.last_read_at < lm.created_at),
         me.done_at is not null,
         (select count(*)::int from conversation_members m where m.conversation_id = c.id and not m.is_sender and m.done_at is not null),
         (select count(*)::int from conversation_members m where m.conversation_id = c.id and not m.is_sender)
  from conversations c
  left join conversation_members me on me.conversation_id = c.id and me.user_id = v_uid
  left join lateral (select x.body, x.author_id, x.created_at from messages x where x.conversation_id = c.id
                     order by x.created_at desc limit 1) lm on true
  where c.ministry_id = v_m and (me.user_id is not null or p_scope = 'all')
  order by c.last_message_at desc
  limit 300;
end
$$;

-- One conversation, with its people, messages and (for the sender of a
-- private batch) everyone else's status.
create or replace function get_conversation(p_conv uuid)
returns jsonb language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); c conversations; v_member boolean; v_sender boolean;
begin
  select * into c from conversations where id = p_conv;
  if c.id is null or c.ministry_id is distinct from current_ministry_id() then raise exception 'Conversation not found'; end if;
  v_member := message_is_member(p_conv, v_uid);
  if not v_member and not message_oversees(c.ministry_id, v_uid) then raise exception 'Conversation not found'; end if;
  v_sender := c.created_by = v_uid;
  return jsonb_build_object(
    'id', c.id, 'subject', c.subject, 'is_task', c.is_task, 'due_on', c.due_on, 'mode', c.mode,
    'batch_id', c.batch_id, 'created_at', c.created_at, 'member', v_member, 'i_sent', v_sender,
    'members', (select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', person_name(c.ministry_id, m.user_id),
                                                    'is_sender', m.is_sender, 'done_at', m.done_at, 'done_note', m.done_note,
                                                    'me', m.user_id = v_uid)
                                 order by m.is_sender desc, person_name(c.ministry_id, m.user_id))
                from conversation_members m where m.conversation_id = c.id),
    'messages', (select jsonb_agg(jsonb_build_object('id', x.id, 'author', person_name(c.ministry_id, x.author_id),
                                                     'mine', x.author_id = v_uid, 'body', x.body, 'created_at', x.created_at,
                                                     'edited_at', x.edited_at,
                                                     'can_edit', x.author_id = v_uid and x.created_at > now() - interval '15 minutes')
                                  order by x.created_at)
                 from messages x where x.conversation_id = c.id),
    'batch', case when v_sender and c.mode = 'direct' then
               (select jsonb_agg(jsonb_build_object('conversation_id', b.id,
                                                    'name', person_name(c.ministry_id, m.user_id),
                                                    'done_at', m.done_at, 'done_note', m.done_note, 'current', b.id = c.id)
                                 order by person_name(c.ministry_id, m.user_id))
                from conversations b join conversation_members m on m.conversation_id = b.id and not m.is_sender
                where b.batch_id = c.batch_id)
             end
  );
end
$$;

create or replace function my_unread_messages()
returns integer language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) then return 0; end if;
  return (select count(*) from conversation_members me
          join conversations c on c.id = me.conversation_id and c.ministry_id = v_m
          where me.user_id = v_uid
            and exists (select 1 from messages x where x.conversation_id = c.id and x.author_id <> v_uid
                          and (me.last_read_at is null or x.created_at > me.last_read_at)));
end
$$;

-- People and classes for the To box.
-- (servant_of: the classes they serve, so the To box can count a class.)
create or replace function message_people()
returns table (user_id uuid, full_name text, roles text, servant_of uuid[])
language plpgsql stable security definer as $$
declare v_uid uuid := auth.uid(); v_m text := current_ministry_id();
begin
  if v_uid is null or not coalesce(ministry_exists(v_m), false) or not message_person_ok(v_m, v_uid) then
    raise exception 'Please sign in again';
  end if;
  return query
  select ur.user_id, person_name(v_m, ur.user_id),
         string_agg(distinct ur.role::text, ','),
         coalesce(array_agg(distinct ur.group_id) filter (where ur.role = 'servant' and ur.group_id is not null), '{}')
  from user_roles ur
  where ur.ministry_id = v_m and ur.user_id <> v_uid and message_person_ok(v_m, ur.user_id)
  group by ur.user_id
  order by 2;
end
$$;

-- ---------------------------------------------------------------------
-- Notifications: catalog, and "due tomorrow" in the 5-minute tick
-- ---------------------------------------------------------------------
insert into notification_events (event, label, description, roles, default_on, sort_order) values
  ('message', 'Messages', 'When someone sends you a message or replies, or finishes a task you gave them.',
   '{admin,general_coordinator,sub_coordinator,servant,read_only}', true, 16),
  ('task_due', 'Task due tomorrow', 'The day before a task you were given is due, if it isn''t done yet.',
   '{admin,general_coordinator,sub_coordinator,servant,read_only}', true, 17)
on conflict (event) do update
  set label = excluded.label, description = excluded.description, roles = excluded.roles,
      default_on = excluded.default_on, sort_order = excluded.sort_order;

create or replace function notify_tasks_due(p_ministry text, p_today date)
returns integer language plpgsql security definer as $$
declare rec record; n int := 0;
begin
  for rec in
    select m.user_id uid, array_agg(c.subject order by c.subject) subjects, array_agg(c.id::text) keys
    from conversations c
    join conversation_members m on m.conversation_id = c.id and not m.is_sender and m.done_at is null
    where c.ministry_id = p_ministry and c.is_task and c.due_on = p_today + 1
      and not exists (select 1 from notification_marks k where k.event = 'task_due' and k.target_user_id = m.user_id and k.mark_key = c.id::text)
      and notify_wants(p_ministry, m.user_id, 'task_due')
    group by m.user_id
  loop
    insert into notification_marks (event, target_user_id, mark_key, ministry_id)
    select 'task_due', rec.uid, k, p_ministry from unnest(rec.keys) k on conflict do nothing;
    insert into notification_outbox (ministry_id, event, audience, target_user_id, title, body, url)
    values (p_ministry, 'task_due', 'person', rec.uid, 'Due tomorrow',
            left(case when array_length(rec.subjects, 1) = 1 then 'Task: ' || rec.subjects[1]
                      else array_length(rec.subjects, 1) || ' tasks: ' || array_to_string(rec.subjects, '; ') end, 160),
            '/messages');
    n := n + 1;
  end loop;
  return n;
end
$$;

-- The 0099 tick, plus "due tomorrow" in the daytime block (from 9 AM).
create or replace function notify_tick()
returns integer language plpgsql security definer as $$
declare
  r record; rec record;
  v_local timestamp; v_today date; v_daytime boolean;
  v_queued int := 0;
  v_names text[]; v_keys text[];
  v_day int; v_hour int; v_y int; v_b int; v_p int; v_g int; v_parts text[];
  v_before int; v_after int; v_label text;
  v_url text;
begin
  for r in
    select m.id, coalesce(s.timezone, 'America/Toronto') tz,
           coalesce(s.birthday_window_days_before, 7) before_days,
           coalesce(s.birthday_window_days_after, 14) after_days
    from ministries m join app_settings s on s.ministry_id = m.id
    where m.is_active
  loop
    v_local := now() at time zone r.tz;
    v_today := v_local::date;
    v_daytime := v_local::time >= time '09:00' and v_local::time < time '21:00';

    if v_daytime then
      for rec in
        select a.id from announcements a
        where a.ministry_id = r.id and a.notified_at is null and a.taken_down_at is null
          and a.starts_on <= v_today and a.ends_on >= v_today
      loop
        perform announcement_enqueue(rec.id);
        v_queued := v_queued + 1;
      end loop;

      if exists (select 1 from push_subscriptions ps
                 where ps.ministry_id = r.id and notify_wants(r.id, ps.user_id, 'outreach_needed')) then
        for rec in
          select y.assigned_servant_id uid,
                 array_agg(notify_short(y.full_name) order by y.full_name) names,
                 array_agg(y.episode) keys
          from notification_yellow(r.id) y
          where y.assigned_servant_id is not null
            and not exists (select 1 from notification_marks k
                            where k.event = 'outreach_needed' and k.target_user_id = y.assigned_servant_id
                              and k.mark_key = y.episode)
            and notify_wants(r.id, y.assigned_servant_id, 'outreach_needed')
          group by y.assigned_servant_id
        loop
          insert into notification_marks (event, target_user_id, mark_key, ministry_id)
          select 'outreach_needed', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
          perform notify_person(r.id, 'outreach_needed', rec.uid, 'Outreach needed',
            notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' hasn''t' else ' haven''t' end
            || ' been at service in a while. Please reach out.');
          v_queued := v_queued + 1;
        end loop;
      end if;

      for rec in
        select st.target_user_id uid from notification_staged st
        where st.ministry_id = r.id and st.event = 'newly_assigned'
        group by st.target_user_id
        having max(st.created_at) < now() - interval '2 minutes'
      loop
        select array_agg(notify_short(x.full_name) order by x.full_name) into v_names
        from (select distinct mem.id, mem.full_name
              from notification_staged st
              join members mem on mem.id = st.member_id
              join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
              where st.ministry_id = r.id and st.event = 'newly_assigned' and st.target_user_id = rec.uid
                and mem.assigned_servant_id = rec.uid and mem.is_new_assignment and mem.status::text = 'active') x;
        if v_names is not null and notify_wants(r.id, rec.uid, 'newly_assigned') then
          perform notify_person(r.id, 'newly_assigned', rec.uid, 'Newly assigned to you',
            notify_names(v_names) || case when array_length(v_names, 1) = 1 then ' is' else ' are' end
            || ' now assigned to you. Say hello!');
          v_queued := v_queued + 1;
        end if;
        delete from notification_staged
        where ministry_id = r.id and event = 'newly_assigned' and target_user_id = rec.uid;
      end loop;

      for rec in
        select oe.servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(oe.id::text) keys
        from outreach_entries oe
        join members mem on mem.id = oe.member_id
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where oe.ministry_id = r.id and oe.follow_up_due = v_today and oe.follow_up_dismissed_at is null
          and oe.servant_id is not null
          and not exists (select 1 from notification_marks k
                          where k.event = 'follow_up_due' and k.target_user_id = oe.servant_id and k.mark_key = oe.id::text)
          and notify_wants(r.id, oe.servant_id, 'follow_up_due')
        group by oe.servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'follow_up_due', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'follow_up_due', rec.uid, 'Follow-up due today',
          'Your follow-up' || case when array_length(rec.names, 1) = 1 then '' else 's' end
          || ' with ' || notify_names(rec.names) || case when array_length(rec.names, 1) = 1 then ' is' else ' are' end
          || ' due today.');
        v_queued := v_queued + 1;
      end loop;

      for rec in
        select mem.assigned_servant_id uid,
               array_agg(notify_short(mem.full_name) order by mem.full_name) names,
               array_agg(mem.id::text || ':' || v_today::text) keys
        from members mem
        join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
        where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
          and mem.assigned_servant_id is not null
          and notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int) = v_today
          and not exists (select 1 from notification_marks k
                          where k.event = 'birthday' and k.target_user_id = mem.assigned_servant_id
                            and k.mark_key = mem.id::text || ':' || v_today::text)
          and notify_wants(r.id, mem.assigned_servant_id, 'birthday')
        group by mem.assigned_servant_id
      loop
        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        select 'birthday', rec.uid, k, r.id from unnest(rec.keys) k on conflict do nothing;
        perform notify_person(r.id, 'birthday', rec.uid, 'Birthday today 🎂',
          case when array_length(rec.names, 1) = 1 then 'Today is ' || rec.names[1] || '''s birthday.'
               else 'Today is the birthday of ' || notify_names(rec.names) || '.' end);
        v_queued := v_queued + 1;
      end loop;

      v_queued := v_queued + notify_tasks_due(r.id, v_today);
    end if;

    for rec in
      select distinct ps.user_id uid from push_subscriptions ps
      where ps.ministry_id = r.id
        and not exists (select 1 from notification_marks k
                        where k.event = 'weekly_recap' and k.target_user_id = ps.user_id
                          and k.mark_key = 'week:' || v_today::text)
        and notify_wants(r.id, ps.user_id, 'weekly_recap')
    loop
      select coalesce(np.weekly_day, 6), coalesce(np.weekly_hour, 9) into v_day, v_hour
      from (select 1) one
      left join notification_preferences np
        on np.user_id = rec.uid and np.ministry_id = r.id and np.event = 'weekly_recap';
      if extract(dow from v_local)::int = v_day and extract(hour from v_local)::int >= v_hour then
        select count(*) into v_y from notification_yellow(r.id) y where y.assigned_servant_id = rec.uid;
        select count(*) into v_b from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.is_new_assignment
            and mem.assigned_servant_id = rec.uid;
        select count(*) into v_p from outreach_entries oe
          join members mem on mem.id = oe.member_id
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where oe.ministry_id = r.id and oe.servant_id = rec.uid and oe.follow_up_due is not null
            and oe.follow_up_dismissed_at is null and oe.follow_up_due <= v_today;
        select count(*) into v_g from (
          select (notify_bday_this_year(mem.date_of_birth, extract(year from v_today)::int)
                  - make_date(extract(year from v_today)::int, 1, 1))
                 - (v_today - make_date(extract(year from v_today)::int, 1, 1)) diff
          from members mem
          join groups g on g.id = mem.group_id and not g.is_archived and g.kind::text <> 'terminal'
          where mem.ministry_id = r.id and mem.status::text = 'active' and mem.date_of_birth is not null
            and mem.assigned_servant_id = rec.uid
        ) b
        where (case when b.diff < -r.before_days then b.diff + 365
                    when b.diff > r.after_days then b.diff - 365 else b.diff end) between -r.before_days and r.after_days;

        insert into notification_marks (event, target_user_id, mark_key, ministry_id)
        values ('weekly_recap', rec.uid, 'week:' || v_today::text, r.id) on conflict do nothing;
        if v_y + v_b + v_p + v_g > 0 then
          v_parts := array[]::text[];
          if v_y > 0 then v_parts := v_parts || (v_y || ' need' || case when v_y = 1 then 's' else '' end || ' outreach'); end if;
          if v_b > 0 then v_parts := v_parts || (v_b || ' newly assigned'); end if;
          if v_p > 0 then v_parts := v_parts || (v_p || ' follow-up' || case when v_p = 1 then '' else 's' end || ' due'); end if;
          if v_g > 0 then v_parts := v_parts || (v_g || ' birthday' || case when v_g = 1 then '' else 's' end); end if;
          perform notify_person(r.id, 'weekly_recap', rec.uid, 'Your weekly recap',
            array_to_string(v_parts, ' · ') || '. Tap to see them on your Dashboard.');
          v_queued := v_queued + 1;
        end if;
      end if;
    end loop;
  end loop;

  delete from notification_marks where created_at < now() - interval '400 days';
  delete from notification_staged where created_at < now() - interval '3 days';

  if v_queued > 0 then
    begin
      select url into v_url from notification_dispatch where id = 1;
      if v_url is not null then
        perform net.http_post(url := v_url, body := '{}'::jsonb,
                              headers := '{"Content-Type": "application/json"}'::jsonb);
      end if;
    exception when others then
      null;
    end;
  end if;
  return v_queued;
end
$$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array[
    'person_name(text, uuid)', 'message_person_ok(text, uuid)', 'message_oversees(text, uuid)', 'message_is_member(uuid, uuid)',
    'message_notify(uuid, uuid, text, text)', 'send_message(uuid[], uuid[], text, text, boolean, date, text)',
    'reply_message(uuid, text)', 'edit_message(uuid, text)', 'set_task_done(uuid, boolean, text)',
    'mark_conversation_read(uuid)', 'my_conversations(text)', 'get_conversation(uuid)', 'my_unread_messages()',
    'message_people()', 'notify_tasks_due(text, date)', 'notify_tick()'
  ] loop
    execute format('alter function %s set search_path = %I, public, pg_temp', f, s);
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'send_message(uuid[], uuid[], text, text, boolean, date, text)', 'reply_message(uuid, text)', 'edit_message(uuid, text)',
    'set_task_done(uuid, boolean, text)', 'mark_conversation_read(uuid)', 'my_conversations(text)', 'get_conversation(uuid)',
    'my_unread_messages()', 'message_people()'
  ] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
