-- ============================================================================
-- Migration 0099: Add UPDATE policy on storage.objects for request-files
-- 
-- Allows authenticated users who can view the request (requesters, approvers,
-- department heads, admins) to overwrite / sanitize attachments (such as
-- unlocking encrypted vendor invoices before stamping).
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

