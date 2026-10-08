-- 0097_role_labels.sql -- APP LABELS FOR THE TWO ROLES (owner-requested
-- 7 Oct 2026). Some ministries don't say "Coordinator" and "Servant":
-- e.g. "Grade Coordinator" or "Steward", "Teacher" or "Class Leader". Each
-- ministry sets its own words in Ministry Settings -> App Labels; the app
-- shows them everywhere instead of the fixed words (plural = word + "s";
-- the General Coordinator role is shown as "General " + the Coordinator
-- word). The database's role names (servant, sub_coordinator) don't change.
-- Run once per environment, QA first:
--     begin; set local search_path to qa; \i 0097_role_labels.sql; commit;
-- Undo with 0097_down_role_labels.sql.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table app_settings add column if not exists servant_label text not null default 'Servant';
alter table app_settings add column if not exists sub_coordinator_label text not null default 'Coordinator';
alter table app_settings drop constraint if exists app_settings_role_labels_check;
alter table app_settings add constraint app_settings_role_labels_check
  check (char_length(btrim(servant_label)) between 2 and 30 and char_length(btrim(sub_coordinator_label)) between 2 and 30);

-- The "new servant waiting" phone notification (0092) says the ministry's
-- own word: "New teacher waiting for approval".
create or replace function notify_pending_servant()
returns trigger language plpgsql security definer as $$
declare
  v_name text := nullif(btrim(new.full_name), '');
  v_word text := coalesce((select lower(nullif(btrim(s.servant_label), '')) from app_settings s
                           where s.ministry_id = new.ministry_id), 'servant');
begin
  if new.approved_at is null then
    insert into notification_outbox (ministry_id, event, audience, title, body, url)
    values (new.ministry_id, 'pending_servant', 'admins_gcs', 'New ' || v_word || ' waiting for approval',
            coalesce(case when v_name is not null then checkin_short_name(v_name, false) end, 'Someone') || ' registered and is waiting for your approval.',
            '/admin/pending-servants');
  end if;
  return new;
end
$$;

do $$
begin
  execute format('alter function notify_pending_servant() set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function notify_pending_servant() from public, anon, authenticated';
end
$$;

