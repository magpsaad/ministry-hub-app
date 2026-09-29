-- 0065_down_qa_storage_policies.sql -- QA ONLY. Restores the qa-* storage
-- rules exactly as they were before 0065 (as captured from the live catalog
-- on 28 Sep 2026). Never touches prod-* rules.

drop policy if exists "qa-photos_insert" on storage.objects;
create policy "qa-photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'qa-photos' and qa.is_app_user());
drop policy if exists "qa-photos_update" on storage.objects;
create policy "qa-photos_update" on storage.objects for update to authenticated
  using (bucket_id = 'qa-photos' and qa.is_app_user());
drop policy if exists "qa-photos_delete" on storage.objects;
create policy "qa-photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'qa-photos' and qa.is_app_user());

drop policy if exists "qa-calendar_insert" on storage.objects;
create policy "qa-calendar_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'qa-calendar' and qa.is_app_user());
drop policy if exists "qa-calendar_update" on storage.objects;
create policy "qa-calendar_update" on storage.objects for update to authenticated
  using (bucket_id = 'qa-calendar' and qa.is_app_user());
drop policy if exists "qa-calendar_delete" on storage.objects;
create policy "qa-calendar_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'qa-calendar' and qa.is_app_user());

drop policy if exists "qa-branding_insert" on storage.objects;
create policy "qa-branding_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'qa-branding' and qa.is_admin());
drop policy if exists "qa-branding_update" on storage.objects;
create policy "qa-branding_update" on storage.objects for update to authenticated
  using (bucket_id = 'qa-branding' and qa.is_admin());
