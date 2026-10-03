-- 0075_down_private_photos.sql -- undoes 0075: the photos bucket is public again
-- and its read rule admits anyone, as before.
--     begin; set local search_path to qa; \i 0075_down_private_photos.sql; commit;

do $$
declare b text := current_schema() || '-photos';
begin
  if current_schema() not in ('qa', 'prod') then
    raise exception 'Run with search_path set to qa or prod (got %)', current_schema();
  end if;
  update storage.buckets set public = true where id = b;
  execute format('drop policy if exists %I on storage.objects', b || '_select');
  execute format('create policy %I on storage.objects for select using (bucket_id = %L)', b || '_select', b);
end
$$;

drop function if exists storage_photo_read_allowed(text);
drop index if exists idx_members_photo_path;
