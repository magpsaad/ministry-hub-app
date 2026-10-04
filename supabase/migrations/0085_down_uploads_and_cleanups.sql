-- 0085_down_uploads_and_cleanups.sql -- undoes 0085: no type/size limits on the
-- storage folders, calendar attachments public again, helper functions
-- callable without signing in again.
--     begin; set local search_path to qa; \i 0085_down_uploads_and_cleanups.sql; commit;

do $$
declare s text := current_schema(); c text := current_schema() || '-calendar'; f text;
begin
  if s not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', s;
  end if;
  update storage.buckets set file_size_limit = null, allowed_mime_types = null
  where id in (s || '-photos', s || '-branding', c);
  update storage.buckets set public = true where id = c;

  execute format('drop policy if exists %I on storage.objects', c || '_select');
  execute format('create policy %I on storage.objects for select using (bucket_id = %L)', c || '_select', c);
  execute format('drop policy if exists %I on storage.objects', c || '_update');
  execute format('create policy %I on storage.objects for update to authenticated using (bucket_id = %L and %I.storage_write_allowed(name, false)) with check (bucket_id = %L and %I.storage_write_allowed(name, false))',
                 c || '_update', c, s, c, s);

  foreach f in array array[
    'accessible_group_ids(boolean)', 'can_manage_servants(uuid)', 'group_ministry_id(uuid)',
    'has_group_access(uuid, uuid)', 'has_readonly_or_full_group_access(uuid, uuid)',
    'is_admin(uuid)', 'is_admin_in(text, uuid)', 'is_admin_or_gc_in(text, uuid)',
    'is_admin_or_general_coordinator(uuid)', 'is_app_user(uuid)', 'is_app_user_in(text, uuid)',
    'is_church_admin(uuid)', 'is_coordinator(uuid)', 'is_coordinator_in(text, uuid)',
    'ministry_exists(text)', 'ministry_is_active(text)'
  ] loop
    execute format('grant execute on function %s to anon', f);
  end loop;
end
$$;
