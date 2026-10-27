-- ============================================================================
-- 0051_disbursement_entry_routing_approver_and_mandatory_consultation.sql
--
-- 1. Clerk / Head Disbursement Entry Account Selection:
--    - In each clerk / head routing for payment-needed requests, choose which
--      Disbursement Entry Only account handles the request.
--    - Head can also update this selection.
--    - The selected Entry Only account gets this request.
--    - Can change anytime BEFORE the first entry is created; once the first entry
--      is created, selection is LOCKED.
--
-- 2. Entry Cash / Bank mode:
--    - When creating each entry, the Entry user chooses 'cash' or 'bank'.
--
-- 3. Payment User Dealer Mode & Entry Account Mapping:
--    - Payment account (casher) dealer mode: 'cash', 'bank', or 'both'.
--    - Payment accounts are connected to specific Entry Only account(s).
--    - Only approved entries created by their connected entry account(s) and
--      matching their cash/bank dealer mode are routed to that payment account.
--
-- 4. Cash Entry Settlement:
--    - When an approved entry is 'cash', the cash-dealing payment account can settle / pay it.
--
-- 5 & 7. Entry Approver Account:
--    - A special account / disbursement type: 'entry_approver'.
--    - Sits between Entry creation and Payment.
--    - Lists all entries created by entry accounts. Shows entry amount, cash/bank mode,
--      TDS, adjustment, and request details.
--    - Approving an entry sends it to the associated cash / bank payment account.
--    - Mobile-responsive interface with "Select All" and bulk approve option.
--
-- 6. Entry Rejection & Correction:
--    - Approver can reject an entry with a reason.
--    - Rejections are notified separately in a dedicated "Rejected Entries" tab in the entry account.
--    - The entry officer can ONLY edit an entry when it has been rejected, correcting it
--      and resubmitting it to proceed further.
--
-- 8. Department Head Mandatory Consultation:
--    - Certain department heads can be configured by Admin with mandatory consultation required
--      with a designated other head.
--    - For all requests this head handles, they cannot approve or forward without this
--      designated head's agreed consultation!
--
-- 9. Discount Approval:
--    - Adds invoice_no and bill_date to discount request details and reports.
-- ============================================================================

-- 1. Profiles & Check Constraints ---------------------------------------------

-- Expand disbursement_type check to include 'entry_approver'
alter table public.profiles drop constraint if exists profiles_disbursement_type_check;
alter table public.profiles
  add constraint profiles_disbursement_type_check
  check (disbursement_type is null or disbursement_type in ('entry_only', 'payment_only', 'stock_transfer_monitor', 'entry_approver'));

-- Add payment dealer mode to profiles ('cash', 'bank', 'both')
alter table public.profiles
  add column if not exists payment_dealer_type text default 'both' check (payment_dealer_type is null or payment_dealer_type in ('cash', 'bank', 'both'));

-- Add mandatory head consultation configuration to profiles
alter table public.profiles
  add column if not exists mandatory_head_consultation boolean not null default false,
  add column if not exists mandatory_consultation_head_id uuid references public.profiles(id) on delete set null,
  add column if not exists mandatory_consultation_head_name text;

-- 2. Payment account to Entry account mapping table ---------------------------

create table if not exists public.payment_entry_account_mappings (
  id uuid primary key default gen_random_uuid(),
  payment_user_id uuid not null references public.profiles(id) on delete cascade,
  entry_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(payment_user_id, entry_user_id)
);

create index if not exists payment_entry_mappings_payment_idx on public.payment_entry_account_mappings(payment_user_id);
create index if not exists payment_entry_mappings_entry_idx on public.payment_entry_account_mappings(entry_user_id);

alter table public.payment_entry_account_mappings enable row level security;
drop policy if exists payment_entry_mappings_select on public.payment_entry_account_mappings;
create policy payment_entry_mappings_select on public.payment_entry_account_mappings for select to authenticated
  using (true);

-- 3. Add assigned Entry account columns to requests --------------------------

alter table public.requests
  add column if not exists assigned_entry_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_entry_user_name text,
  add column if not exists assigned_entry_at timestamptz,
  add column if not exists assigned_entry_by uuid references public.profiles(id) on delete set null;

create index if not exists requests_assigned_entry_user_idx on public.requests(assigned_entry_user_id);

-- 4. Update disbursement_entries table ---------------------------------------

-- Add entry_type ('cash' | 'bank')
alter table public.disbursement_entries
  add column if not exists entry_type text not null default 'bank' check (entry_type in ('cash', 'bank'));

-- Expand status constraint
alter table public.disbursement_entries drop constraint if exists disbursement_entries_status_check;
alter table public.disbursement_entries
  add constraint disbursement_entries_status_check
  check (status in ('pending', 'pending_approval', 'approved', 'rejected', 'paid', 'cancelled'));

-- Approval tracking columns
alter table public.disbursement_entries
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_by_name text,
  add column if not exists approved_at timestamptz;

-- Rejection tracking columns
alter table public.disbursement_entries
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejected_by_name text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 1000);

-- 5. RPC: assign_disbursement_entry_user --------------------------------------
-- Allows Clerk, Department Head, or Admin to choose/change the Entry Only account.
-- Strictly blocked once the first entry is created!

create or replace function public.assign_disbursement_entry_user(
  p_request_id uuid,
  p_entry_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  target_user public.profiles;
  entry_count int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  -- Role authorization check: Admin, or Clerk/Head of the request's department
  if me.role <> 'admin' then
    if me.role not in ('clerk', 'head') or me.department_id is distinct from r.department_id then
      raise exception 'Permission denied: Only the department Clerk, Head, or Admin can assign the disbursement entry account';
    end if;
  end if;

  -- Check if request requires payment
  if r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Disbursement entry accounts cannot be assigned to non-payment requests';
  end if;

  -- Verify no active entries have been created yet
  select count(*) into entry_count
    from public.disbursement_entries
   where request_id = r.id and status <> 'cancelled';

  if entry_count > 0 then
    raise exception 'Selection locked: A disbursement entry has already been created for this request. Entry account cannot be changed.';
  end if;

  -- Validate target user
  select * into target_user from public.profiles where id = p_entry_user_id and is_active;
  if target_user.id is null then
    raise exception 'Target disbursement user not found or inactive';
  end if;
  if target_user.role <> 'admin' and (target_user.role <> 'disbursement' or target_user.disbursement_type is distinct from 'entry_only') then
    raise exception 'Assigned user must be an active Disbursement Entry Only account';
  end if;

  update public.requests
     set assigned_entry_user_id = target_user.id,
         assigned_entry_user_name = target_user.full_name,
         assigned_entry_at = now(),
         assigned_entry_by = me.id,
         updated_at = now()
   where id = r.id;

  perform public._log_action(
    r.id, me, 'assigned_entry_account', r.status, r.status,
    'Assigned Disbursement Entry account to ' || target_user.full_name,
    true
  );

  return jsonb_build_object(
    'success', true,
    'request_id', r.id,
    'assigned_entry_user_id', target_user.id,
    'assigned_entry_user_name', target_user.full_name
  );
end $$;

revoke execute on function public.assign_disbursement_entry_user(uuid, uuid) from public, anon;
grant execute on function public.assign_disbursement_entry_user(uuid, uuid) to authenticated;

-- 6. Update route_request with optional p_assigned_entry_user_id ---------------

create or replace function public.route_request(
  p_request_id uuid,
  p_route public.approval_route,
  p_remarks text default null::text,
  p_assigned_entry_user_id uuid default null
)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  threshold numeric;
  next_status public.request_status;
  has_head boolean;
  v_route public.approval_route;
  target_entry public.profiles;
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

  -- If entry user provided for payment request, assign it
  if p_assigned_entry_user_id is not null and r.request_type not in ('discount', 'non_cash', 'stock_transfer') then
    select * into target_entry from public.profiles where id = p_assigned_entry_user_id and is_active;
    if target_entry.id is not null and (target_entry.role = 'admin' or (target_entry.role = 'disbursement' and target_entry.disbursement_type = 'entry_only')) then
      update public.requests set
        assigned_entry_user_id = target_entry.id,
        assigned_entry_user_name = target_entry.full_name,
        assigned_entry_at = now(),
        assigned_entry_by = me.id
      where id = r.id;
    end if;
  end if;

  -- Asset request handling
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
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

  -- Stock Transfer
  if r.request_type = 'stock_transfer' then
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_approval'; v_route := 'B';
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Exhibition requests always go to Route A
  if r.request_type = 'exhibition' then
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_review'; v_route := 'A';
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Non-Cash requests
  if r.request_type = 'non_cash' then
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_approval'; v_route := 'B';
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- Discount requests
  if r.request_type = 'discount' then
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval'; v_route := 'A';
    else
      next_status := 'pending_head_approval'; v_route := 'B';
    end if;
    update public.requests set
      status = next_status,
      route = v_route,
      routed_by = me.id,
      routed_at = now(),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'routed', r.status, next_status, p_remarks, true);
    perform public.notify_next_actor(r.id, next_status);
    return;
  end if;

  -- General requests
  if p_route = 'B' and r.amount > threshold then
    raise exception 'Requests above % must take Route A (Admin approval)', threshold;
  end if;

  if p_route = 'B' and (r.requester_role = 'head' or not has_head) then
    raise exception 'Head requests cannot be routed to Route B';
  end if;

  if p_route = 'B' then
    next_status := 'pending_head_approval';
  else
    if r.requester_role = 'head' or not has_head then
      next_status := 'pending_admin_approval';
    else
      next_status := 'pending_head_review';
    end if;
  end if;

  update public.requests set
    status = next_status,
    route = p_route,
    routed_by = me.id,
    routed_at = now(),
    updated_at = now()
  where id = r.id;

  perform public._log_action(r.id, me, 'routed', r.status, next_status, p_remarks, true);
  perform public.notify_next_actor(r.id, next_status);
end $function$;

-- Overload without 4th arg for backward compatibility
create or replace function public.route_request(
  p_request_id uuid,
  p_route public.approval_route,
  p_remarks text default null::text
)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  perform public.route_request(p_request_id, p_route, p_remarks, null);
end $function$;

-- 7. Update add_disbursement_entry to support cash/bank & pending approval ------

create or replace function public.add_disbursement_entry(
  p_request_id uuid,
  p_amount numeric,
  p_tds_cut boolean default false,
  p_notes text default null,
  p_adjustment numeric default 0,
  p_entry_type text default 'bank'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_next_no int;
  v_amt numeric;
  v_adj numeric;
  v_entry_id uuid;
  v_pending_sum numeric;
  v_available numeric;
  v_payment_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_paid numeric;
  v_full boolean := false;
  v_adjust_only boolean;
  v_notes text := nullif(btrim(p_notes), '');
  v_type text := coalesce(lower(btrim(p_entry_type)), 'bank');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'entry_only') then
    raise exception 'Permission denied: Only Entry-Only or Admin disbursement accounts can create entries';
  end if;

  if v_type not in ('cash', 'bank') then
    raise exception 'Entry type must be either cash or bank';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type in ('discount', 'non_cash', 'stock_transfer') then raise exception 'Not found'; end if;
  if r.status <> 'approved' then raise exception 'Entries can only be created for approved requests waiting for payment'; end if;

  -- If an Entry account is specifically assigned, ensure only that account or admin creates the entry
  if me.role <> 'admin' and r.assigned_entry_user_id is not null and r.assigned_entry_user_id <> me.id then
    raise exception 'This request has been assigned to % for disbursement entries', coalesce(r.assigned_entry_user_name, 'another entry officer');
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);
  if v_amt < 0 then raise exception 'Entry amount cannot be negative'; end if;
  if v_adj < 0 then raise exception 'Old balance / advance adjustment cannot be negative'; end if;
  if v_amt + v_adj <= 0 then raise exception 'Enter an entry amount or an old balance / advance adjustment'; end if;
  v_adjust_only := v_amt = 0;

  select coalesce(sum(amount), 0) into v_pending_sum
    from public.disbursement_entries
   where request_id = r.id and status in ('pending', 'pending_approval', 'approved');

  v_available := round(r.amount - coalesce(r.paid_amount, 0) - v_pending_sum, 2);
  if v_amt + v_adj > v_available then
    raise exception 'Entry ₹% + adjustment ₹% is more than the balance available for entries (₹%)',
      v_amt, v_adj, greatest(v_available, 0);
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_next_no
    from public.disbursement_entries
   where request_id = r.id;

  -- Entries with an amount to pay start as 'pending_approval' waiting for the Entry Approver.
  -- Adjustment-only entries (amount = 0) are settled immediately.
  insert into public.disbursement_entries (
    request_id, entry_no, amount, adjustment_amount, tds_cut, status, notes, entry_type,
    created_by, created_by_name
  ) values (
    r.id, v_next_no, v_amt, v_adj, coalesce(p_tds_cut, false),
    case when v_adjust_only then 'paid' else 'pending_approval' end,
    v_notes, v_type, me.id, me.full_name
  ) returning id into v_entry_id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_created', r.status, r.status,
    'Entry #' || v_next_no || ' (' || upper(v_type) || ') added: ₹' || to_char(v_amt, 'FM999999999990.00') || ' to pay'
      || case when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
      || case when v_adj > 0
              then ' · Old balance / advance adjusted ₹' || to_char(v_adj, 'FM999999999990.00')
              else '' end
      || ' (Pending Approver sign-off)'
      || coalesce(' · ' || v_notes, ''),
    true
  );

  -- Settle the adjustment immediately if present
  if v_adj > 0 then
    insert into public.request_payments (
      request_id, amount, payment_date, payment_mode, payment_ref, remarks, paid_by, paid_by_name, entry_id, is_adjustment
    ) values (
      r.id, v_adj, v_today, 'Adjustment', null,
      left('Old balance / old advance adjustment · Entry #' || v_next_no || coalesce(' · ' || v_notes, ''), 500),
      me.id, me.full_name, v_entry_id, true
    ) returning id into v_payment_id;

    update public.disbursement_entries set
      adjustment_payment_id = v_payment_id,
      paid_at = case when v_adjust_only then now() else paid_at end,
      paid_by = case when v_adjust_only then me.id else paid_by end,
      paid_by_name = case when v_adjust_only then me.full_name else paid_by_name end,
      payment_id = case when v_adjust_only then v_payment_id else payment_id end
    where id = v_entry_id;

    v_paid := coalesce(r.paid_amount, 0) + v_adj;
    v_full := v_paid >= r.amount;

    if v_full then
      update public.requests set
        status = 'paid',
        paid_amount = v_paid,
        paid_by = me.id,
        paid_at = now(),
        payment_date = v_today,
        payment_mode = 'Adjustment',
        payment_ref = null,
        payment_remarks = 'Old balance / old advance adjustment',
        updated_at = now()
      where id = r.id;

      perform public._log_action(
        r.id, me, 'paid', 'approved', 'paid',
        'Entry #' || v_next_no || ' · ₹' || to_char(v_adj, 'FM999999999990.00')
          || ' settled by old balance / advance adjustment · Paid in full',
        true
      );
      perform public.notify_next_actor(r.id, 'paid');
    else
      update public.requests set paid_amount = v_paid, updated_at = now() where id = r.id;
      perform public._log_action(
        r.id, me, 'partial_payment', 'approved', 'approved',
        'Entry #' || v_next_no || ' · ₹' || to_char(v_adj, 'FM999999999990.00')
          || ' settled by old balance / advance adjustment · Balance remaining ₹'
          || to_char(r.amount - v_paid, 'FM999999999990.00'),
        true
      );
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'entry_no', v_next_no,
    'amount', v_amt,
    'entry_type', v_type,
    'adjustment_amount', v_adj,
    'payable_amount', v_amt,
    'tds_cut', coalesce(p_tds_cut, false),
    'status', case when v_adjust_only then 'paid' else 'pending_approval' end,
    'fully_paid', v_full
  );
end $$;

-- 8. RPC: approve_disbursement_entry (Entry Approver) ---------------------------

create or replace function public.approve_disbursement_entry(
  p_entry_id uuid,
  p_remarks text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_approver') then
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can approve disbursement entries';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending_approval' and e.status <> 'pending' then
    raise exception 'This entry is not waiting for approver review (current status: %)', e.status;
  end if;

  select * into r from public.requests where id = e.request_id for update;

  update public.disbursement_entries set
    status = 'approved',
    approved_at = now(),
    approved_by = me.id,
    approved_by_name = me.full_name,
    rejected_at = null,
    rejected_by = null,
    rejected_by_name = null,
    rejection_reason = null
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_approved', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ' · ₹' || to_char(e.amount, 'FM999999999990.00') || ') approved by '
      || me.full_name || ' · Routed to ' || upper(e.entry_type) || ' payment account'
      || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''),
    true
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', e.amount,
    'entry_type', e.entry_type,
    'status', 'approved'
  );
end $$;

revoke execute on function public.approve_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.approve_disbursement_entry(uuid, text) to authenticated;

-- 9. RPC: approve_multiple_disbursement_entries (Bulk Approve) ----------------

create or replace function public.approve_multiple_disbursement_entries(
  p_entry_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count int := 0;
  v_failed int := 0;
begin
  if p_entry_ids is null or array_length(p_entry_ids, 1) = 0 then
    raise exception 'No entries provided for approval';
  end if;

  foreach v_id in array p_entry_ids loop
    begin
      perform public.approve_disbursement_entry(v_id, 'Bulk approved');
      v_count := v_count + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'success', true,
    'approved_count', v_count,
    'failed_count', v_failed
  );
end $$;

revoke execute on function public.approve_multiple_disbursement_entries(uuid[]) from public, anon;
grant execute on function public.approve_multiple_disbursement_entries(uuid[]) to authenticated;

-- 10. RPC: reject_disbursement_entry (Entry Approver) --------------------------

create or replace function public.reject_disbursement_entry(
  p_entry_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_reason text := nullif(btrim(p_reason), '');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_approver') then
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can reject disbursement entries';
  end if;

  if v_reason is null then
    raise exception 'Please specify the rejection / correction reason';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending_approval' and e.status <> 'pending' then
    raise exception 'This entry is not waiting for approver review (current status: %)', e.status;
  end if;

  select * into r from public.requests where id = e.request_id for update;

  update public.disbursement_entries set
    status = 'rejected',
    rejected_at = now(),
    rejected_by = me.id,
    rejected_by_name = me.full_name,
    rejection_reason = v_reason
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_rejected', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ' · ₹' || to_char(e.amount, 'FM999999999990.00')
      || ') returned for correction by ' || me.full_name || ': ' || v_reason,
    true
  );

  -- Notify the entry creator specifically
  if e.created_by is not null then
    perform public._notify(
      array[e.created_by], r.id, 'Entry #' || e.entry_no || ' returned for correction',
      coalesce(r.request_no, 'Request') || ': ' || v_reason
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'status', 'rejected',
    'rejection_reason', v_reason
  );
end $$;

revoke execute on function public.reject_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.reject_disbursement_entry(uuid, text) to authenticated;

-- 11. RPC: edit_rejected_disbursement_entry (Entry Officer) -------------------
-- "the entry man can only edit when rejected he need to make the correnction in the entry to proceed further"

create or replace function public.edit_rejected_disbursement_entry(
  p_entry_id uuid,
  p_amount numeric,
  p_entry_type text,
  p_tds_cut boolean default false,
  p_notes text default null,
  p_adjustment numeric default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_amt numeric;
  v_adj numeric;
  v_type text;
  v_other_entries_sum numeric;
  v_available numeric;
  v_notes text := nullif(btrim(p_notes), '');
begin
  me := public._me();
  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;

  -- Strictly only allowed when status is 'rejected'
  if e.status <> 'rejected' then
    raise exception 'Only rejected entries can be edited. Current status is %', e.status;
  end if;

  -- Permission: creator or admin
  if me.role <> 'admin' and (me.id is distinct from e.created_by) then
    raise exception 'Permission denied: Only the entry officer who created this entry can edit it';
  end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.status <> 'approved' then raise exception 'Request is no longer waiting for payment'; end if;

  v_type := coalesce(lower(btrim(p_entry_type)), e.entry_type, 'bank');
  if v_type not in ('cash', 'bank') then
    raise exception 'Entry mode must be either cash or bank';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);
  if v_amt < 0 then raise exception 'Entry amount cannot be negative'; end if;
  if v_adj < 0 then raise exception 'Adjustment amount cannot be negative'; end if;
  if v_amt + v_adj <= 0 then raise exception 'Enter an entry amount or adjustment'; end if;

  -- Check remaining balance excluding this entry
  select coalesce(sum(amount), 0) into v_other_entries_sum
    from public.disbursement_entries
   where request_id = r.id and id <> e.id and status in ('pending', 'pending_approval', 'approved');

  v_available := round(r.amount - coalesce(r.paid_amount, 0) - v_other_entries_sum, 2);
  if v_amt + v_adj > v_available then
    raise exception 'Corrected amount ₹% exceeds balance available (₹%)', v_amt + v_adj, v_available;
  end if;

  update public.disbursement_entries set
    amount = v_amt,
    entry_type = v_type,
    tds_cut = coalesce(p_tds_cut, false),
    notes = v_notes,
    adjustment_amount = v_adj,
    status = 'pending_approval',
    rejection_reason = null,
    rejected_by = null,
    rejected_by_name = null,
    rejected_at = null,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_corrected', r.status, r.status,
    'Entry #' || e.entry_no || ' corrected & resubmitted: ₹' || to_char(v_amt, 'FM999999999990.00')
      || ' (' || upper(v_type) || ') '
      || case when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
      || ' (Pending Approver sign-off)',
    true
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', v_amt,
    'entry_type', v_type,
    'status', 'pending_approval'
  );
end $$;

revoke execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric) from public, anon;
grant execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric) to authenticated;

-- 12. Update pay_disbursement_entry to check 'approved' status & dealer routing --

create or replace function public.pay_disbursement_entry(
  p_entry_id uuid,
  p_amount numeric default null,
  p_payment_date date default null,
  p_payment_mode text default null,
  p_payment_ref text default null,
  p_remarks text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_amt numeric;
  v_payable numeric;
  v_date date;
  v_payment_id uuid;
  v_paid numeric;
  v_full boolean;
  v_mapped boolean;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'payment_only') then
    raise exception 'Permission denied: Only Payment-Only or Admin accounts can disburse payments';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;

  -- Entry must be approved by Entry Approver!
  if e.status = 'pending_approval' then
    raise exception 'This entry is awaiting Entry Approver approval before it can be paid';
  end if;
  if e.status = 'rejected' then
    raise exception 'This entry was returned for correction and cannot be paid until corrected and approved';
  end if;
  if e.status <> 'approved' and e.status <> 'pending' then
    raise exception 'This entry is not in an approved payable status (current: %)', e.status;
  end if;

  -- Payment Dealer Mode check (cash vs bank)
  if me.role <> 'admin' and me.payment_dealer_type is not null and me.payment_dealer_type <> 'both' then
    if me.payment_dealer_type <> e.entry_type then
      raise exception 'Dealer mismatch: This account is a % dealer, but Entry #% is designated as a % entry',
        upper(me.payment_dealer_type), e.entry_no, upper(e.entry_type);
    end if;
  end if;

  -- Connected Entry accounts check
  if me.role <> 'admin' and exists (select 1 from public.payment_entry_account_mappings where payment_user_id = me.id) then
    select exists (
      select 1 from public.payment_entry_account_mappings
      where payment_user_id = me.id and entry_user_id = e.created_by
    ) into v_mapped;
    if not v_mapped then
      raise exception 'Routing restriction: Entry #% was created by an entry account not mapped to this payment account', e.entry_no;
    end if;
  end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.id is null or r.request_type = 'discount' then raise exception 'Request not found'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be paid'; end if;

  v_payable := round(least(e.amount, r.amount - coalesce(r.paid_amount, 0)), 2);
  if v_payable <= 0 then raise exception 'Nothing left to pay on Entry #%', e.entry_no; end if;
  v_amt := round(coalesce(p_amount, v_payable), 2);
  if v_amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  if v_amt > v_payable then
    raise exception 'Payment amount (₹%) cannot exceed the amount of Entry #% (₹%)', v_amt, e.entry_no, v_payable;
  end if;

  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date);
  if v_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Payment date cannot be in the future';
  end if;

  insert into public.request_payments (
    request_id, amount, payment_date, payment_mode, payment_ref, remarks, paid_by, paid_by_name, entry_id
  ) values (
    r.id, v_amt, v_date, nullif(btrim(p_payment_mode), ''), nullif(btrim(p_payment_ref), ''),
    nullif(btrim(p_remarks), ''), me.id, me.full_name, e.id
  ) returning id into v_payment_id;

  update public.disbursement_entries set
    status = 'paid',
    paid_at = now(),
    paid_by = me.id,
    paid_by_name = me.full_name,
    payment_id = v_payment_id
  where id = e.id;

  v_paid := coalesce(r.paid_amount, 0) + v_amt;
  v_full := v_paid >= r.amount;

  if v_full then
    update public.requests set
      status = 'paid',
      paid_amount = v_paid,
      paid_by = me.id,
      paid_at = now(),
      payment_date = v_date,
      payment_mode = nullif(btrim(p_payment_mode), ''),
      payment_ref = nullif(btrim(p_payment_ref), ''),
      payment_remarks = nullif(btrim(p_remarks), ''),
      updated_at = now()
    where id = r.id;

    perform public._log_action(
      r.id, me, 'paid', 'approved', 'paid',
      'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ') settled ₹' || to_char(v_amt, 'FM999999999990.00')
        || ' via ' || coalesce(p_payment_mode, 'Payment')
        || case when e.tds_cut then ' (TDS Cut)' else ' (TDS Not Cut)' end
        || ' · Final payment (Paid in full)',
      true
    );
    perform public.notify_next_actor(r.id, 'paid');
  else
    update public.requests set paid_amount = v_paid, updated_at = now() where id = r.id;

    perform public._log_action(
      r.id, me, 'partial_payment', 'approved', 'approved',
      'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ') settled ₹' || to_char(v_amt, 'FM999999999990.00')
        || ' via ' || coalesce(p_payment_mode, 'Payment')
        || case when e.tds_cut then ' (TDS Cut)' else ' (TDS Not Cut)' end
        || ' · Balance remaining ₹' || to_char(r.amount - v_paid, 'FM999999999990.00')
        || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''),
      true
    );
    perform public._notify(
      array[r.requester_id], r.id, 'Payment entry settled',
      coalesce(r.request_no, 'Request') || ' - Entry #' || e.entry_no || ' (₹' || to_char(v_amt, 'FM999999999990.00') || ') paid'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', v_amt,
    'entry_type', e.entry_type,
    'fully_paid', v_full
  );
end $$;



-- 15. Admin Helpers for Payment Dealer & Mandatory Consultation ---------------

create or replace function public.set_payment_dealer_config(
  p_user_id uuid,
  p_dealer_type text,
  p_entry_user_ids uuid[] default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  target public.profiles;
  v_eid uuid;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can configure payment dealer settings'; end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null then raise exception 'User not found'; end if;

  if p_dealer_type is not null and p_dealer_type not in ('cash', 'bank', 'both') then
    raise exception 'Invalid dealer type. Must be cash, bank, or both';
  end if;

  update public.profiles
     set payment_dealer_type = coalesce(p_dealer_type, 'both'),
         updated_at = now()
   where id = p_user_id;

  -- Re-sync mapped entry accounts
  delete from public.payment_entry_account_mappings where payment_user_id = p_user_id;
  if p_entry_user_ids is not null then
    foreach v_eid in array p_entry_user_ids loop
      if v_eid is not null then
        insert into public.payment_entry_account_mappings (payment_user_id, entry_user_id)
        values (p_user_id, v_eid)
        on conflict (payment_user_id, entry_user_id) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'payment_dealer_type', p_dealer_type);
end $$;

revoke execute on function public.set_payment_dealer_config(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_payment_dealer_config(uuid, text, uuid[]) to authenticated;

create or replace function public.set_head_mandatory_consultation(
  p_user_id uuid,
  p_enabled boolean,
  p_target_head_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  target_head public.profiles;
  consult_head public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can configure head consultation rules'; end if;
  select * into target_head from public.profiles where id = p_user_id;
  if target_head.id is null then raise exception 'Department Head not found'; end if;

  if p_enabled then
    if p_target_head_id is null then
      raise exception 'Please choose a mandatory consultation head';
    end if;
    select * into consult_head from public.profiles where id = p_target_head_id and role = 'head' and is_active;
    if consult_head.id is null then
      raise exception 'Mandatory consultation head not found or inactive';
    end if;
    if consult_head.id = p_user_id then
      raise exception 'A department head cannot be their own mandatory consultation head';
    end if;

    update public.profiles set
      mandatory_head_consultation = true,
      mandatory_consultation_head_id = consult_head.id,
      mandatory_consultation_head_name = consult_head.full_name,
      updated_at = now()
    where id = p_user_id;
  else
    update public.profiles set
      mandatory_head_consultation = false,
      mandatory_consultation_head_id = null,
      mandatory_consultation_head_name = null,
      updated_at = now()
    where id = p_user_id;
  end if;

  return jsonb_build_object('success', true, 'user_id', p_user_id, 'mandatory_head_consultation', p_enabled);
end $$;

revoke execute on function public.set_head_mandatory_consultation(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_head_mandatory_consultation(uuid, boolean, uuid) to authenticated;

-- 16. Update RLS & Visibility for Entry Only, Approver, and Payment Accounts ---

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (
  ((select public.my_role()) is not null) and (
    (requester_id = (select auth.uid()))
    or (((select public.my_role()) = 'admin'::public.app_role) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = any (array['clerk'::public.app_role, 'head'::public.app_role]))
        and (department_id = (select public.my_department())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and (owner_head_id = (select auth.uid())) and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'head'::public.app_role)
        and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.can_view_exhibition_waitlist)
        and is_waitlist and (status <> 'draft'::public.request_status))
    or (((select public.my_role()) = 'regional_head'::public.app_role)
        and ((regional_head_id = (select auth.uid())) or (requester_id = (select auth.uid())))
        and (status <> 'draft'::public.request_status or requester_id = (select auth.uid())))
    -- Entry Only accounts: requests assigned to them (or unassigned payable approved requests)
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'entry_only'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type))
        and (assigned_entry_user_id is null or assigned_entry_user_id = (select auth.uid())))
    -- Entry Approver: sees approved requests with entries to review
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'entry_approver'
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type)))
    -- Payment accounts: payable approved requests
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and coalesce((select public.my_disbursement_type()), '') in ('payment_only', '')
        and (status = any (array['approved'::public.request_status, 'paid'::public.request_status, 'cancelled'::public.request_status]))
        and (request_type not in ('discount'::public.request_type, 'non_cash'::public.request_type, 'stock_transfer'::public.request_type)))
    -- Stock Transfer Monitor
    or (((select public.my_role()) = 'disbursement'::public.app_role)
        and (select public.my_disbursement_type()) = 'stock_transfer_monitor'
        and request_type = 'stock_transfer'::public.request_type
        and status = 'approved'::public.request_status)
    or (request_type = 'exhibition'::public.request_type and status not in ('rejected'::public.request_status, 'withdrawn'::public.request_status, 'cancelled'::public.request_status))
    or exists (select 1 from public.head_consultations hc
                where hc.request_id = requests.id and hc.head_id = (select auth.uid()))
  )
);

notify pgrst, 'reload schema';
