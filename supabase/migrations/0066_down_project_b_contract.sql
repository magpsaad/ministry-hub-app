-- 0066_down_project_b_contract.sql -- ROLLBACK of 0066.
--     begin; set local search_path to qa; \i 0066_down_project_b_contract.sql; commit;
-- Turns the SAY transition fallback back on and restores the two dropped
-- columns (qr_codes.printed_at values come back from the B1 backup copy).

update tenancy_settings set default_ministry_id = 'SAY';

alter table app_settings add column id boolean not null default true;
alter table qr_codes add column printed_at timestamptz;
-- The updated_at trigger is paused so restoring printed_at doesn't re-stamp
-- every QR code's "last updated" time.
alter table qr_codes disable trigger trg_qr_codes_updated_at;
do $$
begin
  execute format(
    'update %1$I.qr_codes q set printed_at = b.printed_at from %2$I.qr_codes b where b.id = q.id and b.printed_at is not null',
    current_schema(), current_schema() || '_premm_backup');
end
$$;
alter table qr_codes enable trigger trg_qr_codes_updated_at;

drop function get_qr_codes_with_groups();
create function get_qr_codes_with_groups()
returns table(id uuid, label text, check_in_token uuid, printed_at timestamptz, updated_at timestamptz,
              group_id uuid, ladder_position integer, qr_color text)
language sql stable security definer as $$
  select q.id, q.label, q.check_in_token, q.printed_at, q.updated_at, q.group_id, g.ladder_position::integer, g.qr_color
  from qr_codes q
  left join groups g on g.id = q.group_id
  where q.ministry_id = current_ministry_id() and is_app_user();
$$;
do $$
begin
  execute format('alter function get_qr_codes_with_groups() set search_path = %I, public, pg_temp', current_schema());
end
$$;
revoke all on function get_qr_codes_with_groups() from public, anon, authenticated;
grant execute on function get_qr_codes_with_groups() to authenticated, service_role;

notify pgrst, 'reload schema';
