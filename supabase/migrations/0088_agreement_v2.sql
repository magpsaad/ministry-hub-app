-- 0088_agreement_v2.sql -- AGREEMENT VERSION 2: "OUR RESPONSIBILITY" (the
-- church lawyer's wording, owner-approved 5 Oct 2026). Run once per
-- environment, QA first, together with the app code:
--     begin; set local search_path to qa; \i 0088_agreement_v2.sql; commit;
-- Undo with 0088_down_agreement_v2.sql.
--
-- * Version 2 = version 1 plus a new section, "Our responsibility", right
--   after "Why this agreement". Every other word is copied from version 1.
-- * agreement_versions.accepts_earlier_signatures: a version can be a small
--   addition that does NOT ask people who already signed to sign again
--   (owner's choice for this one). Their signatures keep counting, and their
--   signed copies keep showing exactly the version they signed. Anyone
--   signing from now on signs version 2. A future version left at the
--   default (false) asks everyone to sign again, as before.
-- * agreement_signature_valid() follows that rule: a signature counts if its
--   version is at or after the latest published version that requires a new
--   signature.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

alter table agreement_versions add column if not exists accepts_earlier_signatures boolean not null default false;

create or replace function agreement_signature_valid(p_version_id integer, p_signed_at timestamptz)
returns boolean language sql stable security definer as $$
  select coalesce((
    select sv.version >= (select max(b.version) from agreement_versions b
                          where b.published_at <= now() and not b.accepts_earlier_signatures)
       and (cur.resign_after_months is null or p_signed_at > now() - make_interval(months => cur.resign_after_months))
    from agreement_versions sv, agreement_versions cur
    where sv.id = p_version_id and sv.published_at <= now() and cur.id = current_agreement_version_id()
  ), false);
$$;

do $$
begin
  execute format('alter function agreement_signature_valid(integer, timestamptz) set search_path = %I, public, pg_temp', current_schema());
  execute 'revoke all on function agreement_signature_valid(integer, timestamptz) from public, anon';
  execute 'grant execute on function agreement_signature_valid(integer, timestamptz) to authenticated, service_role';
end
$$;

-- Version 2: version 1's wording with the new section inserted.
do $$
declare
  v1 text;
  anchor constant text := E'\n\n## What is confidential\n';
  addition constant text := E'\n\n## Our responsibility\n\n'
    || 'We understand that personal information is private and that there are legal and ethical protections that apply when collecting, viewing, using, storing or sharing that information. As servants, we are trusted with access to records that belong to the youth, children and families we serve. That trust must be treated seriously.'
    || E'\n\n'
    || 'By using the app, I understand that I am acting as a safeguard and custodian of the information I access. I will protect those records, use them only for the ministry purpose for which they were provided, and take reasonable care to prevent unauthorized access, use, disclosure, copying or loss. I will treat this responsibility as part of my service and not simply as access to an app.';
begin
  if exists (select 1 from agreement_versions where version = 2) then
    return;
  end if;
  select body into v1 from agreement_versions where version = 1;
  if v1 is null or (length(v1) - length(replace(v1, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Version 1 is missing or its "What is confidential" heading was not found exactly once';
  end if;
  insert into agreement_versions (version, title, body, accepts_earlier_signatures)
  select 2, title, replace(v1, anchor, addition || anchor), true
  from agreement_versions where version = 1;
end
$$;
