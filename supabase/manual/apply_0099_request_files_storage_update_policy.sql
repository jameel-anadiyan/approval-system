-- ============================================================================
-- MANUAL MIGRATION 0099: Add UPDATE policy on storage.objects for request-files
-- 
-- Run this in Supabase Dashboard -> SQL Editor -> Run
-- This allows approvers and heads to sanitize and unlock attached PDFs
-- so the stamper can sign them without encryption permission errors.
-- ============================================================================

drop policy if exists "request-files update" on storage.objects;

create policy "request-files update" on storage.objects for update to authenticated
  using (
    bucket_id = 'request-files'
    and public.can_view_request(public.storage_request_id(name))
  )
  with check (
    bucket_id = 'request-files'
    and public.can_view_request(public.storage_request_id(name))
  );

do $$
begin
  raise notice 'SUCCESS: storage.objects update policy on request-files created.';
end $$;

