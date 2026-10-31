-- Migration 0069: Original Bill Missing Workflow
-- Allows Disbursement Entry accounts to flag at any time that an original bill is not attached to a request.
-- Displays in a dedicated 'Bill Missing' glowing red tab for associated Requester, Clerk, Regional Head, and Head.
-- Allows associated users to upload/submit the missing bill, and Entry accounts to review and mark as bill received.

-- 1. Add bill missing columns to requests table ---------------------------------
alter table public.requests
  add column if not exists is_bill_missing boolean default false,
  add column if not exists bill_missing_note text,
  add column if not exists bill_missing_at timestamptz,
  add column if not exists bill_missing_by uuid references public.profiles(id) on delete set null,
  add column if not exists bill_missing_by_name text,
  add column if not exists bill_missing_status text check (bill_missing_status is null or bill_missing_status in ('missing', 'submitted', 'received')),
  add column if not exists bill_submitted_at timestamptz,
  add column if not exists bill_submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists bill_submitted_by_name text,
  add column if not exists bill_submitted_note text,
  add column if not exists bill_submitted_file_path text,
  add column if not exists bill_submitted_file_name text,
  add column if not exists bill_received_at timestamptz,
  add column if not exists bill_received_by uuid references public.profiles(id) on delete set null,
  add column if not exists bill_received_by_name text;

-- 2. Grant table update privileges on bill missing columns to authenticated users
grant update (
  is_bill_missing,
  bill_missing_note,
  bill_missing_at,
  bill_missing_by,
  bill_missing_by_name,
  bill_missing_status,
  bill_submitted_at,
  bill_submitted_by,
  bill_submitted_by_name,
  bill_submitted_note,
  bill_submitted_file_path,
  bill_submitted_file_name,
  bill_received_at,
  bill_received_by,
  bill_received_by_name,
  updated_at
) on public.requests to authenticated;

-- 3. RPC: mark_bill_missing ----------------------------------------------------
create or replace function public.mark_bill_missing(
  p_request_id uuid,
  p_note text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_note text := nullif(btrim(p_note), '');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_only') then
    -- Also allow entry approver if needed, but primary is entry account
    if me.role <> 'disbursement' then
      raise exception 'Permission denied: Only Disbursement Entry accounts or Admin can flag missing bills';
    end if;
  end if;

  if v_note is null then
    raise exception 'Please specify a note explaining why the original bill is missing';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  update public.requests set
    is_bill_missing = true,
    bill_missing_note = v_note,
    bill_missing_at = now(),
    bill_missing_by = me.id,
    bill_missing_by_name = me.full_name,
    bill_missing_status = 'missing',
    updated_at = now()
  where id = r.id;

  perform public._log_action(
    r.id, me, 'bill_missing_flagged', r.status, r.status,
    'Original bill flagged missing by ' || me.full_name || ' (Entry Officer): ' || v_note,
    true
  );

  return jsonb_build_object('success', true, 'request_id', r.id);
end $$;

revoke execute on function public.mark_bill_missing(uuid, text) from public, anon;
grant execute on function public.mark_bill_missing(uuid, text) to authenticated;

-- 4. RPC: submit_missing_bill --------------------------------------------------
create or replace function public.submit_missing_bill(
  p_request_id uuid,
  p_file_path text,
  p_file_name text,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_note text := nullif(btrim(p_note), '');
begin
  me := public._me();

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if not coalesce(r.is_bill_missing, false) then
    raise exception 'This request is not currently flagged for a missing bill';
  end if;

  -- Permission: must be requester, clerk of dept, regional head of request, head of dept, or admin
  if me.role <> 'admin'
    and r.requester_id <> me.id
    and coalesce(r.department_id, '') <> coalesce(me.department_id, '')
    and coalesce(r.regional_head_id, '') <> me.id::text
  then
    raise exception 'Permission denied: You are not associated with this request to submit bills';
  end if;

  update public.requests set
    bill_missing_status = 'submitted',
    bill_submitted_at = now(),
    bill_submitted_by = me.id,
    bill_submitted_by_name = me.full_name,
    bill_submitted_note = v_note,
    bill_submitted_file_path = p_file_path,
    bill_submitted_file_name = p_file_name,
    updated_at = now()
  where id = r.id;

  -- Also insert file into request_files if storage path provided
  if p_file_path is not null and btrim(p_file_path) <> '' then
    insert into public.request_files (
      request_id, kind, storage_path, original_name, mime_type, size_bytes, added_by, added_by_name
    ) values (
      r.id, 'document', p_file_path, coalesce(p_file_name, 'Original_Bill.pdf'), 'application/pdf', 0, me.id, me.full_name
    );
  end if;

  perform public._log_action(
    r.id, me, 'bill_submitted', r.status, r.status,
    'Missing bill document (' || coalesce(p_file_name, 'file') || ') submitted by ' || me.full_name || coalesce(': ' || v_note, ''),
    true
  );

  return jsonb_build_object('success', true, 'request_id', r.id);
end $$;

revoke execute on function public.submit_missing_bill(uuid, text, text, text) from public, anon;
grant execute on function public.submit_missing_bill(uuid, text, text, text) to authenticated;

-- 5. RPC: mark_bill_received ---------------------------------------------------
create or replace function public.mark_bill_received(
  p_request_id uuid,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_note text := nullif(btrim(p_note), '');
begin
  me := public._me();
  if me.role <> 'admin' and me.role <> 'disbursement' then
    raise exception 'Permission denied: Only Disbursement accounts or Admin can mark bill as received';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  update public.requests set
    is_bill_missing = false,
    bill_missing_status = 'received',
    bill_received_at = now(),
    bill_received_by = me.id,
    bill_received_by_name = me.full_name,
    updated_at = now()
  where id = r.id;

  perform public._log_action(
    r.id, me, 'bill_marked_received', r.status, r.status,
    'Original bill verified and marked as received by ' || me.full_name || ' (Entry Officer)' || coalesce(': ' || v_note, ''),
    true
  );

  return jsonb_build_object('success', true, 'request_id', r.id);
end $$;

revoke execute on function public.mark_bill_received(uuid, text) from public, anon;
grant execute on function public.mark_bill_received(uuid, text) to authenticated;

notify pgrst, 'reload schema';
