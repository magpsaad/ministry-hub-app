-- 0085_uploads_and_cleanups.sql -- UPLOAD LIMITS, PRIVATE CALENDAR FILES, FEWER
-- PUBLIC FUNCTIONS (security audit #6 and #10; owner-approved 4 Oct 2026).
-- Run once per environment, QA first, together with the app code that shows
-- calendar attachments through /api/attachment:
--     begin; set local search_path to qa; \i 0085_uploads_and_cleanups.sql; commit;
-- Undo with 0085_down_uploads_and_cleanups.sql.
--
-- * Each storage folder only takes the right kind of file, enforced by
--   storage itself (the app also checks the file's real content):
--     photos     JPG / PNG / WebP images, up to 10 MB
--     branding   JPG / PNG / WebP images, up to 2 MB (logos)
--     calendar   PDF, JPG / PNG / WebP, Word / Excel / PowerPoint, up to 10 MB
-- * Calendar attachments become private, like photos: only people signed in
--   to that ministry can open them (the app gives an hour-long link).
--   Overwriting an attachment file in place is no longer possible (the app
--   always writes a new file).
-- * Internal helper functions are no longer callable without signing in
--   (they answered yes/no questions about someone's roles). The ones the
--   public pages need -- the ministry lookup by address, "today" for
--   check-in, and the poster functions themselves -- stay.
-- Writes no audit entries.

do $$
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
end
$$;

do $$
declare s text := current_schema(); c text := current_schema() || '-calendar';
begin
  update storage.buckets set file_size_limit = 10485760,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = s || '-photos';
  update storage.buckets set file_size_limit = 2097152,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = s || '-branding';
  update storage.buckets set public = false, file_size_limit = 10485760,
         allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.openxmlformats-officedocument.presentationml.presentation']
  where id = c;

  execute format('drop policy if exists %I on storage.objects', c || '_select');
  execute format('create policy %I on storage.objects for select to authenticated using (bucket_id = %L and %I.is_app_user_in((storage.foldername(name))[1]))',
                 c || '_select', c, s);
  execute format('drop policy if exists %I on storage.objects', c || '_update');
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'accessible_group_ids(boolean)', 'can_manage_servants(uuid)', 'group_ministry_id(uuid)',
    'has_group_access(uuid, uuid)', 'has_readonly_or_full_group_access(uuid, uuid)',
    'is_admin(uuid)', 'is_admin_in(text, uuid)', 'is_admin_or_gc_in(text, uuid)',
    'is_admin_or_general_coordinator(uuid)', 'is_app_user(uuid)', 'is_app_user_in(text, uuid)',
    'is_church_admin(uuid)', 'is_coordinator(uuid)', 'is_coordinator_in(text, uuid)',
    'ministry_exists(text)', 'ministry_is_active(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
