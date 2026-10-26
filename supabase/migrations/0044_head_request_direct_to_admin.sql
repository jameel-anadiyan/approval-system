-- ============================================================================
-- 0044_head_request_direct_to_admin.sql
-- Direct routing of Department Head requests to Admin:
-- 1. All requests raised by a Department Head automatically bypass clerk routing
--    and go directly to Admin (status: 'pending_admin_approval', route: 'A')
--    regardless of the amount (no limit or threshold).
-- 2. Work category is not required for Department Head requests since categories
--    are only used to split work among department clerks.
-- 3. Department Head can withdraw their own request while pending Admin approval.
-- 4. Move any existing Head requests currently stuck in clerk/head queues to Admin.
-- ============================================================================

-- 1. Update submit_request
create or replace function public.submit_request(p_request_id uuid)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; rh public.profiles; v_no text; n int; v_rh_count int;
  v_next public.request_status; v_cat_ok boolean;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request cannot be submitted'; end if;

  -- Requester profile must be complete
  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  -- Title and amount sanity
  if r.request_type <> 'non_cash' and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  -- Work category (only needed when several clerks split the target department's work).
  -- Department Head requests bypass clerk routing completely, so work categories are not required for Head.
  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if me.role <> 'head' and public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

  -- Asset Buying (regular): min 2 bills or quotations
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

  -- Asset Buying Below 20k: amount max 20000, min 1 bill or quotation
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

  -- Routing rules:
  -- Department Head: All requests go directly to Admin with route 'A' (no amount limit, bypass clerks)
  if me.role = 'head' then
    v_next := 'pending_admin_approval';
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
      route = 'A',
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

revoke execute on function public.submit_request(uuid) from public, anon;
grant execute on function public.submit_request(uuid) to authenticated;

-- 2. Update withdraw_request to allow Department Head to withdraw while pending Admin approval
create or replace function public.withdraw_request(p_request_id uuid, p_remarks text default null::text)
 returns void language plpgsql security definer set search_path to '' as $function$
declare me public.profiles; r public.requests;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('submitted','pending_regional_review','returned')
     and not (me.role = 'head' and r.status = 'pending_admin_approval') then
    raise exception 'A request can only be withdrawn before routing or while returned';
  end if;
  update public.requests set status = 'withdrawn', updated_at = now() where id = r.id;
  perform public._log_action(r.id, me, 'withdrawn', r.status, 'withdrawn', p_remarks, true);
end $function$;

revoke execute on function public.withdraw_request(uuid, text) from public, anon;
grant execute on function public.withdraw_request(uuid, text) to authenticated;

-- 3. One-time data fix: Move any existing requests raised by Department Heads
-- that are currently stuck in 'submitted', 'pending_head_review', or 'pending_head_approval'
-- directly to 'pending_admin_approval' with route 'A'.
update public.requests r
set status = 'pending_admin_approval',
    route = 'A',
    reviewed_by = coalesce(r.reviewed_by, r.requester_id),
    reviewed_by_name = coalesce(r.reviewed_by_name, r.requester_name),
    reviewed_at = coalesce(r.reviewed_at, now()),
    updated_at = now()
from public.profiles p
where r.requester_id = p.id
  and p.role = 'head'
  and r.status in ('submitted', 'pending_head_review', 'pending_head_approval');

insert into public.request_actions (
  request_id, actor_id, actor_name, actor_role, action, from_status, to_status, remarks, visible_to_requester, created_at
)
select
  r.id, r.requester_id, r.requester_name, 'head'::public.app_role, 'forwarded', 'submitted',
  'pending_admin_approval', 'Automatically redirected to Admin approval queue', true, now()
from public.requests r
join public.profiles p on p.id = r.requester_id and p.role = 'head'
where r.status = 'pending_admin_approval'
  and not exists (
    select 1 from public.request_actions a
    where a.request_id = r.id and a.to_status = 'pending_admin_approval'
  );
