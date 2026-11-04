-- Migration 0084: Allow Petty Cash to be approved directly by Department Head without mandatory consultation
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Update begin_approval to bypass mandatory head consultation and inter-dept consultation checks for Petty Cash
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
    if r.request_type::text = 'audit_report' then
      raise exception 'Audit Report requests can only be approved by the Administrator';
    end if;
    if v_prev <> 'pending_head_approval' then
      raise exception 'This request is not waiting for your approval';
    end if;
    if r.request_type::text = 'petty_cash' and r.owner_head_id is not null then
      if r.owner_head_id <> me.id then
        raise exception 'This Petty Cash request is assigned to another Petty Cash Dealing Head';
      end if;
    elsif not (r.department_id = me.department_id or r.owner_head_id = me.id) then
      raise exception 'This request is not waiting for your approval';
    end if;

    -- Mandatory Head Consultation Check (Skipped for Petty Cash — can be approved directly by Head itself)
    if r.request_type::text <> 'petty_cash' and me.mandatory_head_consultation and me.mandatory_consultation_head_id is not null then
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

  if r.requester_id = me.id and not (me.role = 'head' and r.request_type::text in ('agreement', 'statutory_payment')) then
    raise exception 'You cannot approve your own request';
  end if;

  if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
    raise exception 'Select the best quotation before approving';
  end if;

  -- Inter-Department Head Consultations check (Skipped for Petty Cash)
  if r.request_type::text <> 'petty_cash' then
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
      'requester_id', r.requester_id,
      'requester_name', r.requester_name,
      'owner_head_id', r.owner_head_id,
      'department', d.name,
      'department_code', d.code,
      'submitted_at', r.submitted_at,
      'verify_token', r.verify_token,
      'reviewed_by_name', r.reviewed_by_name,
      'reviewed_at', r.reviewed_at,
      'request_type', r.request_type,
      'details', r.details,
      'shop_name', r.shop_name,
      'owner_head_name', r.owner_head_name,
      'assigned_entry_user_name', r.assigned_entry_user_name,
      'disbursement_mode', r.disbursement_mode,
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
      where f.request_id = r.id
        and f.kind = 'document'
        and lower(coalesce(f.mime_type, '')) in ('application/pdf', 'image/jpeg', 'image/jpg', 'image/png')
    ), '[]'::jsonb),
    'all_documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'original_name', f.original_name,
        'mime_type', f.mime_type,
        'size_bytes', f.size_bytes
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

-- 2. Update forward_request to also skip mandatory consultation for Petty Cash
create or replace function public.forward_request(p_request_id uuid, p_remarks text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  pending_count int;
  disagreed_count int;
  v_mand_ok boolean;
  v_mand_name text;
begin
  me := public._me();
  if me.role is distinct from 'head' then
    raise exception 'Only a head can forward';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not (r.department_id = me.department_id or r.owner_head_id = me.id) then
    raise exception 'Not found';
  end if;
  if r.status <> 'pending_head_review' then
    raise exception 'Not waiting for head review';
  end if;
  if r.requester_id = me.id then
    raise exception 'You cannot review your own request';
  end if;
  if exists (
    select 1 from public.head_consultations
    where request_id = r.id and head_id = me.id
  ) then
    raise exception 'Consulted heads cannot forward requests of another department';
  end if;
  if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
    raise exception 'Select the best quotation before forwarding to Admin';
  end if;

  -- Mandatory Head Consultation Check (Skipped for Petty Cash):
  if r.request_type::text <> 'petty_cash' and me.mandatory_head_consultation and me.mandatory_consultation_head_id is not null then
    select exists (
      select 1 from public.head_consultations
      where request_id = r.id
        and head_id = me.mandatory_consultation_head_id
        and status = 'agreed'
    ) into v_mand_ok;

    if not v_mand_ok then
      select full_name into v_mand_name from public.profiles where id = me.mandatory_consultation_head_id;
      raise exception 'Mandatory consultation with % is required and must be agreed before forwarding this request',
        coalesce(v_mand_name, 'the designated Department Head');
    end if;
  end if;

  -- Inter-Department Head Consultation checks (Skipped for Petty Cash):
  if r.request_type::text <> 'petty_cash' then
    select count(*) into pending_count
    from public.head_consultations
    where request_id = r.id and status = 'pending';

    if pending_count > 0 then
      raise exception 'Cannot forward: Awaiting review response from % consulted department head(s)', pending_count;
    end if;

    select count(*) into disagreed_count
    from public.head_consultations
    where request_id = r.id and status = 'disagreed';

    if disagreed_count > 0 then
      raise exception 'Cannot forward: % consulted department head(s) disagreed with this request', disagreed_count;
    end if;
  end if;

  update public.requests set
    status = 'pending_admin_approval',
    route = 'A'::public.approval_route,
    reviewed_by = me.id,
    reviewed_by_name = me.full_name,
    reviewed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'forwarded', r.status, 'pending_admin_approval', p_remarks, true);

  delete from public.notifications
  where request_id = r.id
    and title = 'Request waiting for your review'
    and read_at is null;

  perform public.notify_next_actor(r.id, 'pending_admin_approval');
end $$;

revoke execute on function public.forward_request(uuid, text) from public, anon;
grant execute on function public.forward_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';
