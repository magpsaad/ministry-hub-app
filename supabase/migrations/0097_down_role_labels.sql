-- 0097_down_role_labels.sql -- undoes 0097: the fixed words again.
--     begin; set local search_path to qa; \i 0097_down_role_labels.sql; commit;

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

create or replace function notify_pending_servant()
returns trigger language plpgsql security definer as $$
declare v_name text := nullif(btrim(new.full_name), '');
begin
  if new.approved_at is null then
    insert into notification_outbox (ministry_id, event, audience, title, body, url)
    values (new.ministry_id, 'pending_servant', 'admins_gcs', 'New servant waiting for approval',
            coalesce(case when v_name is not null then checkin_short_name(v_name, false) end, 'Someone') || ' registered and is waiting for your approval.',
            '/admin/pending-servants');
  end if;
  return new;
end
$$;

alter table app_settings drop constraint if exists app_settings_role_labels_check;
alter table app_settings drop column if exists servant_label;
alter table app_settings drop column if exists sub_coordinator_label;
