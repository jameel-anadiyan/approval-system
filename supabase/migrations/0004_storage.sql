-- 0004 — Storage buckets (all private) and policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('request-files', 'request-files', false, 20971520,
    array['application/pdf','image/jpeg','image/png',
          'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-wav','audio/aac','audio/x-m4a']),
  ('signed-documents', 'signed-documents', false, 104857600, array['application/pdf']),
  ('credentials', 'credentials', false, 2097152, array['image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- request-files: read by anyone who can see the request, except Disbursement
create policy "request-files read" on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (select public.my_role()) <> 'disbursement'
    and public.can_view_request(public.storage_request_id(name))
  );

-- request-files: requester uploads while draft or returned (no overwrite: no update policy)
create policy "request-files insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and public.can_edit_request_files(public.storage_request_id(name))
  );

create policy "request-files delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-files'
    and public.can_edit_request_files(public.storage_request_id(name))
  );

-- signed-documents: read by anyone who can see the approved/paid request; written by server only
create policy "signed-documents read" on storage.objects for select to authenticated
  using (
    bucket_id = 'signed-documents'
    and exists (select 1 from public.requests r
                where r.id = public.storage_request_id(name) and r.status in ('approved','paid'))
    and public.can_view_request(public.storage_request_id(name))
  );

-- credentials: no policies → server (service role) only.
