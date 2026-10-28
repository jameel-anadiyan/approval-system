-- ============================================================================
-- 0058_fix_begin_approval_return_payload.sql
--
-- Fix: Signing failed — try again. (Cannot read properties of undefined (reading 'full_name'))
--
-- Why the problem occurred:
-- In migration 0051 (both part 2 and the monolithic version), public.begin_approval
-- was accidentally truncated to return only:
--   jsonb_build_object('success', true, 'approval_no', v_no, 'department_name', d.name, ...)
-- completely stripping out:
--   - 'request'
--   - 'approver' (full_name, designation, role, department)
--   - 'decided_at'
--   - 'files'
--   - 'timeline'
--
-- When the Edge Function "approve-request" called begin_approval, b.approver was
-- undefined, causing `b.approver.full_name` to throw:
--   "Cannot read properties of undefined (reading 'full_name')"
--
-- This migration restores the full JSONB return payload expected by the signing engine.
-- ============================================================================

create or replace function public.begin_approval(p_request_id uuid, p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  c public.approver_credentials;
  d public.departments;
  v_no text;
  v_prev public.request_status;
  v_now timestamptz := now();
  pending_count int;
  disagreed_count int;
  v_mand_ok boolean;
  v_mand_name text;
begin
  select * into me from public.profiles where id = p_approver_id and is_active;
  if me.id is null then raise exception 'Approver not found'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;

  if r.status = 'approving' then
    if r.approving_started_at > v_now - interval '1 minute' then
      raise exception 'Approval already in progress';
    end if;
    v_prev := r.status_before_approving;
  else
    v_prev := r.status;
  end if;

  if me.role = 'head' then
    if v_prev <> 'pending_head_approval' or r.department_id <> me.department_id then
      raise exception 'This request is not waiting for your approval';
    end if;

    -- Mandatory Head Consultation Check:
    if me.mandatory_head_consultation and me.mandatory_consultation_head_id is not null then
      select exists (
        select 1 from public.head_consultations
        where request_id = r.id
          and head_id = me.mandatory_consultation_head_id
          and status = 'agreed'
      ) into v_mand_ok;

      if not v_mand_ok then
        select full_name into v_mand_name from public.profiles where id = me.mandatory_consultation_head_id;
        raise exception 'Mandatory consultation with % is required and must be agreed before approving this request',
          coalesce(v_mand_name, 'the designated Department Head');
      end if;
    end if;

  elsif me.role = 'admin' then
    if v_prev <> 'pending_admin_approval' then raise exception 'This request is not waiting for your approval'; end if;
  else
    raise exception 'Only a Head or Admin can approve';
  end if;
  if r.requester_id = me.id then raise exception 'You cannot approve your own request'; end if;

  -- Asset quotation selection requirement:
  if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
    raise exception 'Select the best quotation before approving';
  end if;

  -- Inter-Department Head Consultation checks:
  select count(*) into pending_count
  from public.head_consultations
  where request_id = r.id and status = 'pending';

  if pending_count > 0 then
    raise exception 'Cannot approve: Awaiting review response from % consulted department head(s)', pending_count;
  end if;

  select count(*) into disagreed_count
  from public.head_consultations
  where request_id = r.id and status = 'disagreed';

  if disagreed_count > 0 then
    raise exception 'Cannot approve: % consulted department head(s) disagreed with this request', disagreed_count;
  end if;

  select * into c from public.approver_credentials where user_id = me.id;
  if c.seal_path is null or c.signature_path is null then
    raise exception 'Upload your seal and signature before approving';
  end if;

  v_no := coalesce(r.approval_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'approval_prefix'), 'APR')));

  update public.requests set
    status = 'approving',
    approval_no = v_no,
    approving_by = me.id,
    approving_started_at = v_now,
    status_before_approving = v_prev,
    decided_at = v_now,
    last_error = null,
    updated_at = v_now
  where id = r.id;

  select * into d from public.departments where id = r.department_id;

  return jsonb_build_object(
    'success', true,
    'approval_no', v_no,
    'decided_at', v_now,
    'department_name', d.name,
    'seal_path', c.seal_path,
    'signature_path', c.signature_path,
    'request', jsonb_build_object(
      'id', r.id,
      'request_no', r.request_no,
      'title', r.title,
      'notes', r.notes,
      'amount', r.amount,
      'route', r.route,
      'requester_name', r.requester_name,
      'department', d.name,
      'department_code', d.code,
      'submitted_at', r.submitted_at,
      'verify_token', r.verify_token,
      'reviewed_by_name', r.reviewed_by_name,
      'reviewed_at', r.reviewed_at,
      'request_type', r.request_type,
      'details', r.details,
      'shop_name', r.shop_name,
      'quote_selected_by_name', r.quote_selected_by_name,
      'quote_selected_at', r.quote_selected_at
    ),
    'approver', jsonb_build_object(
      'id', me.id,
      'full_name', me.full_name,
      'designation', me.designation,
      'role', me.role,
      'department', (select name from public.departments where id = me.department_id)
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'storage_path', f.storage_path,
        'original_name', f.original_name,
        'mime_type', f.mime_type,
        'quote_vendor', f.quote_vendor,
        'quote_amount', f.quote_amount,
        'quote_preferred', f.quote_preferred,
        'quote_status', f.quote_status
      ) order by f.sort_order, f.created_at)
      from public.request_files f
      where f.request_id = r.id and f.kind = 'document'
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'actor_name', a.actor_name,
        'actor_role', a.actor_role,
        'action', a.action,
        'remarks', a.remarks,
        'created_at', a.created_at
      ) order by a.created_at)
      from public.request_actions a
      where a.request_id = r.id
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.begin_approval(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_approval(uuid, uuid) to service_role;

-- Recover any request that may be stuck in 'approving' state due to prior failed sign attempts:
update public.requests
set status = coalesce(status_before_approving, 'pending_admin_approval'),
    approving_by = null,
    approving_started_at = null,
    status_before_approving = null
where status = 'approving';

notify pgrst, 'reload schema';
