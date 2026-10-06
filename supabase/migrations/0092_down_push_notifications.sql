-- 0092_down_push_notifications.sql -- undoes 0092: no phone notifications.
--     begin; set local search_path to qa; \i 0092_down_push_notifications.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

drop trigger if exists trg_notify_pending_servant on pending_servants;
drop function if exists notify_pending_servant();
drop function if exists push_mark_sent(bigint, text[], text[], text);
drop function if exists push_claim(integer);
drop function if exists remove_push_subscription(text);
drop function if exists save_push_subscription(text, text, text, text);
drop table if exists notification_outbox;
drop table if exists push_subscriptions;
