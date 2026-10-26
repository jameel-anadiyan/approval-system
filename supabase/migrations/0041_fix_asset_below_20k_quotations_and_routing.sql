-- ============================================================================
-- 0041_fix_asset_below_20k_quotations_and_routing.sql
-- Fix: Support asset_below_20k in quotation saving, draft updating, routing,
-- file removal, quotation selection, and approval initialization.
-- ============================================================================

-- 1. set_quote: Allow asset_below_20k requests to save quotations / bills
create or replace function public.set_quote(
  p_file_id uuid,
  p_vendor text,
  p_amount numeric,
  p_preferred boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  f public.request_files;
  r public.requests;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'Not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  if r.request_type <> 'asset' and r.request_type <> 'asset_below_20k' then
    raise exception 'Quotations are only for asset buying requests';
  end if;
  if f.kind <> 'document' or f.added_by is not null then
    raise exception 'Only your own documents can be quotations';
  end if;
  if nullif(btrim(coalesce(p_vendor, '')), '') is null then
    raise exception 'Enter the vendor name for each quotation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount for each quotation';
  end if;
  if r.request_type = 'asset_below_20k' and p_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;
  if coalesce(p_preferred, false) then
    update public.request_files set quote_preferred = false where request_id = r.id and id <> f.id;
  end if;
  update public.request_files set
    quote_vendor = left(btrim(p_vendor), 150),
    quote_amount = round(p_amount, 2),
    quote_preferred = coalesce(p_preferred, false),
    quote_status = 'pending'
  where id = f.id;
  perform public._sync_asset_amount(r.id);
end $$;
revoke execute on function public.set_quote(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.set_quote(uuid, text, numeric, boolean) to authenticated;

-- 2. remove_file: Sync asset amount for asset_below_20k as well
create or replace function public.remove_file(p_file_id uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  f public.request_files;
  r public.requests;
begin
  me := public._me();
  select * into f from public.request_files where id = p_file_id;
  if f.id is null then raise exception 'Not found'; end if;
  select * into r from public.requests where id = f.request_id for update;
  if r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  if f.added_by is not null and f.added_by <> me.id then raise exception 'This voice note was added by an approver'; end if;
  delete from public.request_files where id = f.id;
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
  return f.storage_path;
end $function$;

-- 3. update_typed_draft: Support asset_below_20k and non_cash properly
create or replace function public.update_typed_draft(
  p_request_id uuid,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb
)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  v jsonb;
  v_title text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;
  v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(p_details, r.details));
  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null then raise exception 'Title is required'; end if;
  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type = 'non_cash' then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = case when r.request_type = 'non_cash' then coalesce(p_details, r.details) else v->'details' end,
    updated_at = now()
  where id = r.id;
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;

-- 4. route_request: Clerk forwards asset_below_20k for quote selection
create or replace function public.route_request(
  p_request_id uuid,
  p_route public.approval_route,
  p_remarks text default null::text
)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  threshold numeric;
  next_status public.request_status;
  has_head boolean;
  v_route public.approval_route;
begin
  me := public._me();
  if me.role is distinct from 'clerk' then raise exception 'Only a clerk can route requests'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'submitted' then raise exception 'Not waiting for clerk routing'; end if;
  if not (me.id = any(public._clerk_ids_for(r.department_id, r.category_id))) then
    raise exception 'This request is for the % clerk', coalesce(r.category_name, 'assigned');
  end if;

  select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
  threshold := coalesce(threshold, 10000);

  select exists (
    select 1 from public.profiles
    where department_id = r.department_id and role = 'head' and is_active
  ) into has_head;

  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    -- The Head's quote choice decides the level, so the clerk only forwards.
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_review'; v_route := null;
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'sent_for_quote_selection', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  if p_route = 'B' then
    if r.amount > threshold then raise exception 'Above threshold: Admin approval required'; end if;
    if r.requester_role = 'head' then raise exception 'A head cannot approve own request'; end if;
    if not has_head then raise exception 'Department has no active head'; end if;
    next_status := 'pending_head_approval';
  elsif r.requester_role = 'head' or not has_head then
    next_status := 'pending_admin_approval';
  else
    next_status := 'pending_head_review';
  end if;

  update public.requests set
    status = next_status,
    route = p_route,
    routed_by = me.id,
    routed_at = now(),
    updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me,
    case when r.requester_id = me.id then 'routed_own_' else 'routed_' end || p_route::text,
    r.status, next_status, p_remarks, true);
  perform public.notify_next_actor(r.id, next_status);
end $function$;

-- 5. forward_request: Prevent skipping quote selection for asset_below_20k
create or replace function public.forward_request(p_request_id uuid, p_remarks text default null::text)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  pending_count int;
  disagreed_count int;
begin
  me := public._me();
  if me.role is distinct from 'head' then raise exception 'Only a head can forward'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.department_id <> me.department_id then raise exception 'Not found'; end if;
  if r.status <> 'pending_head_review' then raise exception 'Not waiting for head review'; end if;
  if r.requester_id = me.id then raise exception 'You cannot review your own request'; end if;
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    raise exception 'Select the best quotation; that decides Head or Admin approval';
  end if;

  select count(*) into pending_count from public.head_consultations where request_id = r.id and status = 'pending';
  if pending_count > 0 then
    raise exception 'Cannot forward: Awaiting review response from % consulted department head(s)', pending_count;
  end if;
  select count(*) into disagreed_count from public.head_consultations where request_id = r.id and status = 'disagreed';
  if disagreed_count > 0 then
    raise exception 'Cannot forward: % consulted department head(s) disagreed with this request', disagreed_count;
  end if;

  update public.requests set
    status = 'pending_admin_approval',
    reviewed_by = me.id,
    reviewed_by_name = me.full_name,
    reviewed_at = now(),
    updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, 'forwarded', r.status, 'pending_admin_approval', p_remarks, true);
  perform public.notify_next_actor(r.id, 'pending_admin_approval');
end $function$;

-- 6. select_quote: Fix notification and support asset_below_20k
create or replace function public.select_quote(p_request_id uuid, p_file_id uuid, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  f public.request_files;
  threshold numeric;
  next_status public.request_status;
  v_route public.approval_route;
  n int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or (r.request_type <> 'asset' and r.request_type <> 'asset_below_20k') then
    raise exception 'Not found';
  end if;
  select * into f from public.request_files where id = p_file_id and request_id = r.id;
  if f.id is null or f.quote_amount is null then
    raise exception 'That document is not a quotation on this request';
  end if;

  if me.role = 'head' then
    if r.department_id <> me.department_id or r.requester_id = me.id then raise exception 'Not found'; end if;
    if r.status not in ('pending_head_review','pending_head_approval') then
      raise exception 'This request is not waiting for quote selection';
    end if;
    select count(*) into n from public.head_consultations where request_id = r.id and status in ('pending','disagreed');
    if n > 0 then raise exception 'Resolve the inter-department head consultations first'; end if;
  elsif me.role = 'admin' then
    if r.status <> 'pending_admin_approval' then raise exception 'This request is not waiting for Admin approval'; end if;
    if r.selected_quote_id is not null then
      raise exception 'The Head has already selected the quotation; Admin approves or returns it';
    end if;
  else
    raise exception 'Only the Head (or Admin) can select the quotation';
  end if;

  update public.request_files set quote_status = case when id = f.id then 'selected' else 'rejected' end
   where request_id = r.id and quote_amount is not null;

  next_status := r.status;
  v_route := r.route;
  if me.role = 'head' then
    select value::numeric into threshold from public.app_settings where key = 'high_value_threshold';
    threshold := coalesce(threshold, 10000);
    if f.quote_amount <= threshold then
      next_status := 'pending_head_approval'; v_route := 'B';
    else
      next_status := 'pending_admin_approval'; v_route := 'A';
    end if;
  end if;

  update public.requests set
    selected_quote_id = f.id,
    quote_selected_by = me.id,
    quote_selected_by_name = me.full_name,
    quote_selected_at = now(),
    amount = f.quote_amount,
    status = next_status,
    route = v_route,
    reviewed_by = case when next_status = 'pending_admin_approval' and me.role = 'head' then me.id else reviewed_by end,
    reviewed_by_name = case when next_status = 'pending_admin_approval' and me.role = 'head' then me.full_name else reviewed_by_name end,
    reviewed_at = case when next_status = 'pending_admin_approval' and me.role = 'head' then now() else reviewed_at end,
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'quote_selected', r.status, next_status,
    'Selected ' || coalesce(f.quote_vendor, f.original_name) || ' · Rs. ' || to_char(f.quote_amount, 'FM999999999990.00')
      || case when next_status = 'pending_admin_approval' and r.status <> 'pending_admin_approval'
              then ' · above limit, sent to Admin' else '' end
      || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''),
    true);

  perform public.notify_next_actor(r.id, next_status);

  return jsonb_build_object(
    'selected_quote_id', f.id,
    'amount', f.quote_amount,
    'status', next_status,
    'route', v_route
  );
end $$;
revoke execute on function public.select_quote(uuid, uuid, text) from public, anon;
grant execute on function public.select_quote(uuid, uuid, text) to authenticated;

-- 7. begin_approval: Require selected quote for asset_below_20k before approval
create or replace function public.begin_approval(p_request_id uuid, p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
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
begin
  select * into me from public.profiles where id = p_approver_id and is_active;
  if me.id is null then raise exception 'Approver not found'; end if;
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;

  if r.status = 'approving' then
    if r.approving_started_at > v_now - interval '1 minute' then
      raise exception 'Approval already in progress';
    end if;
    v_prev := r.status_before_approving;   -- stuck run: allow retry
  else
    v_prev := r.status;
  end if;

  if me.role = 'head' then
    if v_prev <> 'pending_head_approval' or r.department_id <> me.department_id then
      raise exception 'This request is not waiting for your approval';
    end if;
  elsif me.role = 'admin' then
    if v_prev <> 'pending_admin_approval' then raise exception 'This request is not waiting for your approval'; end if;
  else
    raise exception 'Only a Head or Admin can approve';
  end if;
  if r.requester_id = me.id then raise exception 'You cannot approve your own request'; end if;
  if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
    raise exception 'Select the best quotation before approving';
  end if;

  select count(*) into pending_count from public.head_consultations where request_id = r.id and status = 'pending';
  if pending_count > 0 then
    raise exception 'Cannot approve: Awaiting review response from % consulted department head(s)', pending_count;
  end if;
  select count(*) into disagreed_count from public.head_consultations where request_id = r.id and status = 'disagreed';
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
    'request', jsonb_build_object(
      'id', r.id, 'request_no', r.request_no, 'title', r.title, 'notes', r.notes,
      'amount', r.amount, 'route', r.route, 'requester_name', r.requester_name, 'department', d.name,
      'department_code', d.code, 'submitted_at', r.submitted_at, 'verify_token', r.verify_token,
      'reviewed_by_name', r.reviewed_by_name, 'reviewed_at', r.reviewed_at,
      'request_type', r.request_type, 'details', r.details, 'shop_name', r.shop_name,
      'quote_selected_by_name', r.quote_selected_by_name, 'quote_selected_at', r.quote_selected_at
    ),
    'approval_no', v_no,
    'decided_at', v_now,
    'approver', jsonb_build_object(
      'id', me.id, 'full_name', me.full_name, 'designation', me.designation,
      'role', me.role, 'department', (select name from public.departments where id = me.department_id)
    ),
    'seal_path', c.seal_path,
    'signature_path', c.signature_path,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'storage_path', f.storage_path,
        'original_name', f.original_name, 'mime_type', f.mime_type,
        'quote_vendor', f.quote_vendor, 'quote_amount', f.quote_amount, 'quote_preferred', f.quote_preferred,
        'quote_status', f.quote_status
      ) order by f.sort_order, f.created_at)
      from public.request_files f where f.request_id = r.id and f.kind = 'document'
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'actor_name', a.actor_name, 'actor_role', a.actor_role,
        'action', a.action, 'remarks', a.remarks, 'created_at', a.created_at
      ) order by a.created_at)
      from public.request_actions a where a.request_id = r.id
    ), '[]'::jsonb)
  );
end $function$;
revoke execute on function public.begin_approval(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_approval(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
