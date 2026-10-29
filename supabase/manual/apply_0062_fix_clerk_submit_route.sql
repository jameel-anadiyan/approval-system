-- ==============================================================================
-- APPLY THIS SCRIPT IN SUPABASE SQL EDITOR TO FIX:
-- "column "route" is of type public.approval_route but expression is of type text"
-- when Clerk or Head submits a request.
-- ==============================================================================

drop function if exists public.submit_request(uuid);
drop function if exists public.submit_request(uuid, uuid);

create or replace function public.submit_request(
  p_request_id uuid,
  p_entry_user_id uuid default null
)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  rh public.profiles;
  v_no text;
  n int;
  v_rh_count int;
  v_next public.request_status;
  v_cat_ok boolean;
  target_entry_user public.profiles;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request cannot be submitted'; end if;

  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  if r.request_type <> 'non_cash' and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_entry_user_id is not null then
    select * into target_entry_user from public.profiles where id = p_entry_user_id and is_active;
    if target_entry_user.id is null then
      raise exception 'Target disbursement entry account not found or inactive';
    end if;
    if target_entry_user.role <> 'disbursement'
       or target_entry_user.disbursement_type is distinct from 'entry_only'
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

  -- Department Head AND Clerk requests that need disbursement must name the Entry account at submit.
  if me.role in ('head', 'clerk') and r.request_type not in ('discount', 'non_cash', 'stock_transfer') then
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account before submitting this request';
    end if;
  end if;

  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if me.role not in ('head', 'clerk') and public._category_required(r.department_id) then
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

  if me.role = 'head' then
    v_next := 'pending_admin_approval';
  elsif me.role = 'clerk' then
    -- Clerk requests go directly to Department Head!
    if r.request_type = 'exhibition' or r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;
  elsif me.role = 'employee' then
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
    v_next := case when rh.id is not null then 'pending_regional_review' else 'submitted' end;
  else
    v_next := 'submitted';
  end if;

  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));

  if me.role = 'head' then
    update public.requests set
      status = 'pending_admin_approval',
      request_no = v_no,
      route = 'A'::public.approval_route,
      routed_by = me.id,
      routed_at = now(),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'submitted', r.status, 'pending_admin_approval',
      'Department Head request routed directly to Admin for approval', true);
    perform public.notify_next_actor(r.id, 'pending_admin_approval');
  elsif me.role = 'clerk' then
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

    perform public._log_action(r.id, me, 'submitted', r.status, v_next,
      'Clerk request routed directly to Department Head for review and approval', true);
    perform public.notify_next_actor(r.id, v_next);
  else
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

    perform public._log_action(r.id, me, 'submitted', r.status, v_next, null, true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
