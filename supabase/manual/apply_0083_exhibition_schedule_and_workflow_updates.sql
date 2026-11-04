-- Run in Supabase SQL Editor:
-- Migration 0083: Exhibition schedule, pre-sealing form sync, head-to-head routing, cancellation cleanup
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Update can_edit_request_files to include 'exhibition'
create or replace function public.can_edit_request_files(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.requests r
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = p_request_id
      and (
        (r.requester_id = me.id and r.status in ('draft', 'returned'))
        or (
          r.status = 'returned'
          and (
            me.role = 'admin'
            or (me.role in ('head', 'clerk') and (r.department_id = me.department_id or r.owner_head_id = me.id or r.routed_by = me.id))
            or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.department_id = me.department_id))
          )
        )
        or (
          r.status not in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled')
          and (
            me.role = 'admin'
            or (
              me.role = 'head'
              and (
                r.department_id = me.department_id
                or r.owner_head_id = me.id
                or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
              )
            )
            or (
              r.request_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report', 'exhibition')
              and (
                r.requester_id = me.id
                or (me.role = 'clerk' and r.department_id = me.department_id)
                or (me.role = 'regional_head' and r.regional_head_id = me.id)
              )
            )
          )
        )
      )
  );
$$;

revoke execute on function public.can_edit_request_files(uuid) from public, anon;
grant execute on function public.can_edit_request_files(uuid) to authenticated;

-- 2. Security definer RPC: sync_exhibition_form_file
create or replace function public.sync_exhibition_form_file(
  p_request_id uuid,
  p_storage_path text,
  p_original_name text,
  p_size_bytes bigint,
  p_page_count int default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  v_id uuid;
  v_clean_name text := coalesce(nullif(btrim(p_original_name), ''), 'Exhibition_Event_Approval_Form.pdf');
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.request_type::text <> 'exhibition' then
    raise exception 'sync_exhibition_form_file is only for Exhibition / Event requests';
  end if;
  if r.status in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled') then
    raise exception 'Cannot modify files on a finalized request';
  end if;

  if not (
    r.requester_id = me.id
    or me.role = 'admin'
    or (me.role in ('head', 'clerk') and (r.owner_head_id = me.id or r.department_id = me.department_id or r.routed_by = me.id))
    or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.department_id = me.department_id))
  ) then
    raise exception 'Not authorized to sync request form';
  end if;

  if public.storage_request_id(p_storage_path) is distinct from r.id then
    raise exception 'Bad file path';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'Form PDF file was not uploaded';
  end if;

  delete from public.request_files
  where request_id = r.id
    and kind = 'document'
    and (
      sort_order = -1
      or lower(original_name) like 'exhibition_event_approval_form%'
    );

  insert into public.request_files (
    request_id, kind, storage_path, original_name, mime_type, size_bytes,
    page_count, sort_order, added_by, added_by_name, added_by_role
  )
  values (
    r.id, 'document', p_storage_path, left(v_clean_name, 255),
    'application/pdf', p_size_bytes, greatest(1, coalesce(p_page_count, 1)), -1,
    null, null, null
  )
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.sync_exhibition_form_file(uuid, text, text, bigint, int) from public, anon;
grant execute on function public.sync_exhibition_form_file(uuid, text, text, bigint, int) to authenticated;

-- 3. Update cancel_approved_request:
--    When approval is cancelled, decline all pending disbursement clarifications,
--    cancel non-paid disbursement entries, and delete entry locks.
create or replace function public.cancel_approved_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  ids uuid[];
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Not found'; end if;
  if me.role is distinct from 'head' and me.role is distinct from 'admin' then
    raise exception 'Only the request owner Head or Admin can cancel this request';
  end if;
  if me.role = 'head' and not (r.owner_head_id = me.id or r.department_id = me.department_id) then
    raise exception 'Only the request owner Head can cancel this request';
  end if;
  if r.status = 'paid' then raise exception 'This request is already fully paid and can no longer be cancelled'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be cancelled'; end if;
  if char_length(v_reason) < 3 then raise exception 'Please give a reason for cancelling'; end if;

  update public.requests set
    status = 'cancelled',
    cancelled_by = me.id,
    cancelled_by_name = me.full_name,
    cancelled_at = now(),
    cancel_reason = left(v_reason, 1000),
    updated_at = now()
  where id = r.id;

  -- 1. Decline all pending disbursement clarifications for this request so no clarification messages remain
  update public.disbursement_clarifications
  set status = 'declined',
      resolved_at = now()
  where request_id = r.id
    and status = 'pending_head';

  -- 2. Cancel non-paid disbursement entries so they completely leave disbursement account queues
  update public.disbursement_entries
  set status = 'cancelled'
  where request_id = r.id
    and status not in ('paid', 'completed');

  -- 3. Delete any entry locks
  delete from public.disbursement_entry_locks
  where request_id = r.id;

  perform public._log_action(r.id, me, 'cancelled', 'approved', 'cancelled',
    v_reason || case when r.paid_amount > 0
      then ' · ₹' || to_char(r.paid_amount, 'FM999999999990.00') || ' already paid before cancellation' else '' end,
    true);

  select array_agg(id) into ids from public.profiles
   where is_active and id <> me.id and (
     id = r.requester_id
     or (role = 'disbursement' and r.request_type <> 'discount')
     or (role = 'admin' and (r.route = 'A' or r.approver_role = 'admin'))
     or (role in ('clerk','head') and department_id = r.department_id));
  perform public._notify(ids, r.id, 'Approval cancelled - ' || coalesce(r.approval_no, r.request_no, ''),
    coalesce(r.request_no, 'Request') || ' - ' || r.title || ' · ' || v_reason);
end $$;

revoke execute on function public.cancel_approved_request(uuid, text) from public, anon;
grant execute on function public.cancel_approved_request(uuid, text) to authenticated;

-- 4. Update submit_request:
--    - Handles Department Head routing:
--        - Route to Other Head: checks category and routes to that Head's appointed clerk (or directly to Head if no clerk)
--        - Default: routes directly to Admin for approval
--    - Handles Audit Report: always routes to Admin for final approval
create or replace function public.submit_request(p_request_id uuid, p_entry_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  rh public.profiles;
  pc_head public.profiles;
  dept_head public.profiles;
  target_head public.profiles;
  v_clerk_ids uuid[];
  v_no text;
  n int;
  v_rh_count int;
  v_next public.request_status;
  v_cat_ok boolean;
  target_entry_user public.profiles;
  v_can_submit boolean := false;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'This request cannot be submitted (current status: %)', r.status; end if;

  if r.status = 'draft' then
    if r.requester_id <> me.id then
      raise exception 'Only the requester can submit a draft request';
    end if;
  elsif r.status = 'returned' then
    v_can_submit := (
      r.requester_id = me.id
      or me.role = 'admin'
      or (me.role = 'head' and (
            r.department_id = me.department_id
            or r.owner_head_id = me.id
            or r.reviewed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
            or exists (select 1 from public.head_consultations hc where hc.request_id = r.id and hc.head_id = me.id)
         ))
      or (me.role = 'clerk' and (
            r.department_id = me.department_id
            or r.routed_by = me.id
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
      or (me.role = 'regional_head' and (
            r.regional_head_id = me.id
            or r.department_id = me.department_id
            or exists (select 1 from public.regional_head_shops rhs where rhs.regional_head_id = me.id and rhs.shop_id = r.shop_id)
            or exists (select 1 from public.request_actions a where a.request_id = r.id and a.actor_id = me.id)
         ))
    );
    if not v_can_submit then
      raise exception 'You do not have permission to resubmit this request';
    end if;
  end if;

  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  if r.request_type::text not in ('non_cash', 'agreement', 'audit_report') and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_entry_user_id is not null and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report') then
    select * into target_entry_user from public.profiles where id = p_entry_user_id and is_active;
    if target_entry_user.id is null then
      raise exception 'Target disbursement entry account not found or inactive';
    end if;
    if target_entry_user.role <> 'disbursement'
       or coalesce(nullif(btrim(target_entry_user.disbursement_type), ''), 'entry_only') not in ('entry_only', 'entry')
       or (lower(coalesce(target_entry_user.designation, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.username, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
      raise exception 'Selected user must be an active Disbursement Entry Only account';
    end if;

    update public.requests set
      assigned_entry_user_id = target_entry_user.id,
      assigned_entry_user_name = target_entry_user.full_name,
      assigned_entry_at = now(),
      assigned_entry_by = me.id
    where id = r.id;

    r.assigned_entry_user_id := target_entry_user.id;
    r.assigned_entry_user_name := target_entry_user.full_name;
  end if;

  -- Petty Cash validation & clerk-skipping routing
  if r.request_type::text = 'petty_cash' then
    if r.amount > 1000 then
      raise exception 'Petty Cash amount cannot exceed ₹1,000';
    end if;
    if nullif(btrim(coalesce(r.notes, '')), '') is null then
      raise exception 'Note is mandatory for Petty Cash requests';
    end if;
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account for this Petty Cash request';
    end if;

    if me.role = 'head' and (r.owner_head_id is null or r.owner_head_id = me.id) then
      pc_head := null;
    else
      if r.owner_head_id is null then
        raise exception 'Please select a Petty Cash Dealing Head';
      end if;
      select * into pc_head
      from public.profiles
      where id = r.owner_head_id and role = 'head' and is_active;

      if pc_head.id is null or not pc_head.is_petty_cash_dealer then
        raise exception 'Selected Department Head is not an active Petty Cash Dealer';
      end if;
    end if;

    if me.role = 'employee' then
      if me.regional_head_id is not null then
        select p.* into rh from public.profiles p
         where p.id = me.regional_head_id and p.role = 'regional_head' and p.is_active;
      end if;

      if rh.id is null and me.shop_id is not null then
        select count(*) into v_rh_count from public.profiles p
          join public.regional_head_shops s on s.regional_head_id = p.id
         where p.role = 'regional_head' and p.is_active
           and s.shop_id = me.shop_id;
        if v_rh_count = 1 then
          select p.* into rh from public.profiles p
            join public.regional_head_shops s on s.regional_head_id = p.id
           where p.role = 'regional_head' and p.is_active
             and s.shop_id = me.shop_id;
        elsif v_rh_count > 1 then
          raise exception 'Your Regional Head is not assigned yet. Ask your Head to assign one before submitting';
        end if;
      end if;
    end if;

    v_no := coalesce(r.request_no, public.next_number(
      coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

    if me.role = 'employee' and rh.id is not null then
      update public.requests set
        status = 'pending_regional_review',
        request_no = v_no,
        owner_head_id = pc_head.id,
        owner_head_name = pc_head.full_name,
        department_id = pc_head.department_id,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = null,
        routed_by = null,
        routed_at = null,
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        regional_head_id = rh.id,
        regional_head_name = rh.full_name,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_regional_review',
        'Petty Cash submitted to Regional Head (Target Head: ' || pc_head.full_name || ')', true);
      perform public.notify_next_actor(r.id, 'pending_regional_review');
      return;

    elsif pc_head.id is not null then
      update public.requests set
        status = 'pending_head_approval',
        request_no = v_no,
        owner_head_id = pc_head.id,
        owner_head_name = pc_head.full_name,
        department_id = pc_head.department_id,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = 'B'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_head_approval',
        'Petty Cash routed directly to ' || pc_head.full_name || ' (clerk skipped)', true);
      perform public.notify_next_actor(r.id, 'pending_head_approval');
      return;

    else
      update public.requests set
        status = 'pending_admin_approval',
        request_no = v_no,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        route = 'A'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = me.id,
        reviewed_by_name = me.full_name,
        reviewed_at = now(),
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_admin_approval',
        'Department Head Petty Cash routed directly to Admin for approval', true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;
  end if;

  -- Non-Petty-Cash validation
  if me.role in ('head', 'clerk')
     and r.request_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report') then
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account before submitting this request';
    end if;
  end if;

  if r.request_type::text in ('agreement', 'statutory_payment', 'audit_report') then
    if nullif(btrim(coalesce(r.notes, r.details->>'description', '')), '') is null then
      raise exception 'Description is required before submitting';
    end if;
  end if;

  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);

  -- Category check: for employees, or for Head routing to another head when target department requires categories
  if (me.role not in ('head', 'clerk', 'admin') or (me.role = 'head' and r.owner_head_id is not null and r.owner_head_id <> me.id))
     and public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

  if r.request_type = 'asset' then
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 2 then raise exception 'Attach at least 2 bills or quotations, each with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  if r.request_type = 'asset_below_20k' then
    if r.amount > 20000 then raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k'; end if;
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 1 then raise exception 'Attach at least 1 bill or quotation with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

  -- Agreement & Statutory Payment: ONLY Department Head approval (Route B; never Admin)
  if r.request_type::text in ('agreement', 'statutory_payment') then
    if me.role in ('head', 'admin', 'clerk') or (me.role = 'regional_head' and r.status = 'returned') then
      if r.owner_head_id is not null then
        select * into dept_head from public.profiles where id = r.owner_head_id and role = 'head' and is_active;
      end if;
      if dept_head.id is null and me.role = 'head' then
        dept_head := me;
      end if;
      if dept_head.id is null and r.department_id is not null then
        select * into dept_head from public.profiles
         where department_id = r.department_id and role = 'head' and is_active limit 1;
      end if;

      update public.requests set
        status = 'pending_head_approval',
        request_no = v_no,
        route = 'B'::public.approval_route,
        owner_head_id = coalesce(dept_head.id, r.owner_head_id),
        owner_head_name = coalesce(dept_head.full_name, r.owner_head_name),
        department_id = coalesce(dept_head.department_id, r.department_id),
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_head_approval',
        'Routed directly to Department Head for approval (Route B — Head Approval Only)', true);
      perform public.notify_next_actor(r.id, 'pending_head_approval');
      return;
    end if;
  end if;

  -- Audit Report: ONLY Admin approval (Route A)
  if r.request_type::text = 'audit_report' and me.role in ('head', 'admin') then
    update public.requests set
      status = 'pending_admin_approval',
      request_no = v_no,
      route = 'A'::public.approval_route,
      routed_by = coalesce(r.routed_by, me.id),
      routed_at = coalesce(r.routed_at, now()),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, 'pending_admin_approval',
      'Audit Report routed directly to Admin for approval', true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
    return;
  end if;

  if me.role in ('head', 'admin') then
    -- Head routing to another Department Head
    if me.role = 'head' and r.owner_head_id is not null and r.owner_head_id <> me.id then
      select * into target_head from public.profiles where id = r.owner_head_id and role = 'head' and is_active;
      if target_head.id is null then
        raise exception 'Target Department Head not found or inactive';
      end if;

      -- Check if target head's department has appointed clerk(s)
      select array_agg(u) into v_clerk_ids
      from unnest(public._clerk_ids_for(target_head.department_id, r.category_id)) u
      where u is not null;

      if v_clerk_ids is not null and array_length(v_clerk_ids, 1) > 0 then
        -- Target department has clerk: route to clerk first ('submitted')
        update public.requests set
          status = 'submitted',
          request_no = v_no,
          route = null,
          routed_by = null,
          routed_at = null,
          reviewed_by = null,
          reviewed_by_name = null,
          reviewed_at = null,
          owner_head_id = target_head.id,
          owner_head_name = target_head.full_name,
          department_id = target_head.department_id,
          regional_head_id = null,
          regional_head_name = null,
          regional_forwarded_at = null,
          submitted_at = coalesce(submitted_at, now()),
          updated_at = now()
        where id = r.id;

        perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
          r.status, 'submitted',
          'Request routed to ' || target_head.full_name || '''s department clerk', true);
        perform public.notify_next_actor(r.id, 'submitted');
        return;
      else
        -- No clerk: routes directly to target head
        update public.requests set
          status = 'pending_head_approval',
          request_no = v_no,
          route = 'B'::public.approval_route,
          routed_by = coalesce(r.routed_by, me.id),
          routed_at = coalesce(r.routed_at, now()),
          reviewed_by = null,
          reviewed_by_name = null,
          reviewed_at = null,
          owner_head_id = target_head.id,
          owner_head_name = target_head.full_name,
          department_id = target_head.department_id,
          regional_head_id = null,
          regional_head_name = null,
          regional_forwarded_at = null,
          submitted_at = coalesce(submitted_at, now()),
          updated_at = now()
        where id = r.id;

        perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
          r.status, 'pending_head_approval',
          'Request routed directly to Department Head ' || target_head.full_name || ' (no clerk)', true);
        perform public.notify_next_actor(r.id, 'pending_head_approval');
        return;
      end if;
    else
      -- Default: Route to Admin
      update public.requests set
        status = 'pending_admin_approval',
        request_no = v_no,
        route = 'A'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = me.id,
        reviewed_by_name = me.full_name,
        reviewed_at = now(),
        regional_head_id = null,
        regional_head_name = null,
        regional_forwarded_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_admin_approval',
        case when r.status = 'returned' then 'Request resubmitted to Admin for approval'
             else 'Department Head request routed directly to Admin for approval' end,
        true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;

  elsif me.role = 'clerk' then
    if r.request_type::text = 'audit_report'
       or r.request_type = 'exhibition'
       or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment')
           and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = (case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end),
      routed_by = me.id,
      routed_at = now(),
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Clerk resubmitted request to Department Head for review and approval'
           else 'Clerk request routed directly to Department Head for review and approval' end,
      true);
    perform public.notify_next_actor(r.id, v_next);

  elsif me.role = 'regional_head' and r.status = 'returned' then
    if r.request_type::text = 'audit_report'
       or r.request_type = 'exhibition'
       or (r.request_type::text not in ('discount', 'stock_transfer', 'agreement', 'statutory_payment')
           and r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000)) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = (case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end),
      regional_head_id = me.id,
      regional_head_name = me.full_name,
      regional_forwarded_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'resubmitted', r.status, v_next,
      'Regional Head resubmitted request to Department Head', true);
    perform public.notify_next_actor(r.id, v_next);

  else
    -- Employee (or Regional Head submitting new own request -> clerk)
    if me.role = 'employee' then
      if me.regional_head_id is not null then
        select p.* into rh from public.profiles p
         where p.id = me.regional_head_id and p.role = 'regional_head' and p.is_active;
      end if;

      if rh.id is null and me.shop_id is not null then
        select count(*) into v_rh_count from public.profiles p
          join public.regional_head_shops s on s.regional_head_id = p.id
         where p.role = 'regional_head' and p.is_active
           and s.shop_id = me.shop_id;
        if v_rh_count = 1 then
          select p.* into rh from public.profiles p
            join public.regional_head_shops s on s.regional_head_id = p.id
           where p.role = 'regional_head' and p.is_active
             and s.shop_id = me.shop_id;
        elsif v_rh_count > 1 then
          raise exception 'Your Regional Head is not assigned yet. Ask your Head to assign one before submitting';
        end if;
      end if;
    end if;

    v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;

    update public.requests set
      status = v_next,
      request_no = v_no,
      route = null,
      routed_by = null,
      routed_at = null,
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = rh.id,
      regional_head_name = rh.full_name,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Request resubmitted after correction' else null end,
      true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
