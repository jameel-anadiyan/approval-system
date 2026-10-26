-- ============================================================================
-- 0045_delete_all_requests.sql
-- Delete ALL requests, child records, files, payments, consultations,
-- clarifications, entries, and notifications; reset sequence counters.
-- Also creates an Admin RPC public.delete_all_requests().
-- ============================================================================

-- 1. Create delete_all_requests RPC (Admin only)
create or replace function public.delete_all_requests()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only administrators can delete all requests';
  end if;

  -- 1. Operational child & parent data
  delete from public.disbursement_entries;
  delete from public.disbursement_clarifications;
  delete from public.head_consultations;
  delete from public.request_payments;
  delete from public.request_actions;
  delete from public.signed_files;
  delete from public.request_files;
  delete from public.notifications where request_id is not null;
  delete from public.requests;

  -- 2. Clear request attachments from storage
  delete from storage.objects where bucket_id in ('request-files', 'signed-documents');

  -- 3. Reset sequence counters so requests start back at REQ-2026-000001
  delete from public.counters;
end $$;

revoke execute on function public.delete_all_requests() from public, anon;
grant execute on function public.delete_all_requests() to authenticated;

-- 2. Execute deletion immediately upon migration run
delete from public.disbursement_entries;
delete from public.disbursement_clarifications;
delete from public.head_consultations;
delete from public.request_payments;
delete from public.request_actions;
delete from public.signed_files;
delete from public.request_files;
delete from public.notifications where request_id is not null;
delete from public.requests;

-- Clear request storage files
delete from storage.objects where bucket_id in ('request-files', 'signed-documents');

-- Reset counters back to 0
delete from public.counters;
