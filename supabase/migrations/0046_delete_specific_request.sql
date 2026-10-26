-- ============================================================================
-- 0046_delete_specific_request.sql
-- Function to permanently delete a specific request:
-- Completely erases the request, its child tables (disbursement entries,
-- clarifications, consultations, payments, actions, files, notifications),
-- and removes attached files from storage.
-- It reflects everywhere, including disbursement, so the request no longer exists.
-- ============================================================================

create or replace function public.delete_request_permanently(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_storage_paths text[];
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'Request not found';
  end if;

  -- Security check: Admin can permanently delete ANY request.
  -- Requesters can only delete their own draft, returned, or withdrawn requests.
  if me.role <> 'admin' and (r.requester_id <> me.id or r.status not in ('draft', 'returned', 'withdrawn')) then
    raise exception 'Only administrators can permanently delete active requests';
  end if;

  -- Collect file storage paths before deleting metadata
  select array_agg(storage_path) into v_storage_paths
  from (
    select storage_path from public.request_files where request_id = r.id
    union all
    select storage_path from public.signed_files where request_id = r.id
  ) s where storage_path is not null;

  -- 1. Explicitly clear all child operational records (also covered by cascade)
  delete from public.disbursement_entries where request_id = r.id;
  delete from public.disbursement_clarifications where request_id = r.id;
  delete from public.head_consultations where request_id = r.id;
  delete from public.request_payments where request_id = r.id;
  delete from public.request_actions where request_id = r.id;
  delete from public.signed_files where request_id = r.id;
  delete from public.request_files where request_id = r.id;
  delete from public.notifications where request_id = r.id;

  -- 2. Delete the request record itself
  delete from public.requests where id = r.id;

  -- 3. Delete files from storage buckets
  if v_storage_paths is not null and array_length(v_storage_paths, 1) > 0 then
    delete from storage.objects
    where bucket_id in ('request-files', 'signed-documents')
      and name = any(v_storage_paths);
  end if;

  -- Clean up any files organized in a subfolder named after the request ID
  delete from storage.objects
  where bucket_id in ('request-files', 'signed-documents')
    and (name like (r.id::text || '/%') or name like ('%' || r.id::text || '%'));

end $$;

revoke execute on function public.delete_request_permanently(uuid) from public, anon;
grant execute on function public.delete_request_permanently(uuid) to authenticated;
