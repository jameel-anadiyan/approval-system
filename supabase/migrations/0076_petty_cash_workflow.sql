-- ============================================================================
-- 0076_petty_cash_workflow.sql
--
-- Petty Cash Request Workflow (Maximum ₹1,000):
-- 1. Adds `is_petty_cash_dealer` flag on `public.profiles` + Admin RPC
--    `public.set_petty_cash_dealer` + reader `public.get_petty_cash_dealers`.
-- 2. Enforces `0 < amount <= 1000`, cash default, mandatory note, optional voice
--    note & optional supporting document(s), mandatory Petty Cash Dealing Head,
--    and mandatory Disbursement Entry Account.
-- 3. Clerk-skipping routing:
--    - Employee WITH Regional Head -> Regional Head (`pending_regional_review`)
--      -> Regional Head forwards DIRECTLY to Petty Cash Dealing Head
--      (`pending_head_approval`, Route B), skipping Clerk.
--    - Employee WITHOUT Regional Head -> DIRECTLY to Petty Cash Dealing Head
--      (`pending_head_approval`, Route B), skipping Clerk.
--    - Regional Head raising directly -> DIRECTLY to Petty Cash Dealing Head
--      (`pending_head_approval`, Route B), skipping Clerk.
-- 4. Allows Employee (while draft/returned), Regional Head, and Department Head
--    to set/edit `assigned_entry_user_id`.
-- 5. Adds `sync_petty_cash_form_file` + updates `begin_approval` so
--    "Petty Cash Form Below 1000" and any optional supporting documents are
--    always stamped cleanly.
-- ============================================================================

-- 1. Add Petty Cash Dealer flag to profiles
alter table public.profiles
  add column if not exists is_petty_cash_dealer boolean not null default false;

-- 2. Admin RPC to enable/disable Petty Cash Dealer on a Department Head
create or replace function public.set_petty_cash_dealer(
  p_user_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  target public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can enable or disable Petty Cash Dealers';
  end if;

  select * into target from public.profiles where id = p_user_id;
  if target.id is null then
    raise exception 'User not found';
  end if;
  if target.role <> 'head' then
    raise exception 'Only Department Heads can be enabled as Petty Cash Dealers';
  end if;

  update public.profiles
  set is_petty_cash_dealer = coalesce(p_enabled, false),
      updated_at = now()
  where id = p_user_id;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (
    me.id,
    me.full_name,
    'petty_cash_dealer_changed',
    'user',
    target.id::text,
    jsonb_build_object(
      'username', target.username,
      'full_name', target.full_name,
      'from', target.is_petty_cash_dealer,
      'to', coalesce(p_enabled, false)
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', target.id,
    'is_petty_cash_dealer', coalesce(p_enabled, false)
  );
end $$;

revoke execute on function public.set_petty_cash_dealer(uuid, boolean) from public, anon;
grant execute on function public.set_petty_cash_dealer(uuid, boolean) to authenticated;

-- 3. Reader RPC: get all active Petty Cash Dealing Heads
create or replace function public.get_petty_cash_dealers()
returns table (
  head_id uuid,
  head_name text,
  username text,
  designation text,
  department_id uuid,
  department_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.id as head_id,
    h.full_name as head_name,
    h.username,
    h.designation,
    h.department_id,
    coalesce(d.name, 'Department') as department_name
  from public.profiles h
  left join public.departments d on d.id = h.department_id
  where h.role = 'head'
    and h.is_active = true
    and h.is_petty_cash_dealer = true
  order by h.full_name asc;
$$;

revoke execute on function public.get_petty_cash_dealers() from public, anon;
grant execute on function public.get_petty_cash_dealers() to authenticated;

-- 4. Update _build_details to validate & structure Petty Cash (max ₹1,000)
create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
  v_mode text;
  v_items jsonb;
  v_item jsonb;
  v_pieces int := 0;
  v_gross_wt numeric := 0;
  v_mrp_total numeric := 0;
  v_from_shop text;
  v_to_shop text;
  v_conducting_shop_name text;
begin
  if p_type::text = 'petty_cash' then
    if p_amount is null or p_amount <= 0 then
      raise exception 'Amount must be greater than zero';
    end if;
    if p_amount > 1000 then
      raise exception 'Petty Cash amount cannot exceed ₹1,000';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'petty_cash_form', 'petty_cash_form_below_1000',
        'max_limit', 1000,
        'total_amount', round(p_amount, 2)
      ))
    );

  elsif p_type = 'non_cash' then
    return jsonb_build_object(
      'amount', 0,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'associated_value', public._num(d, 'associated_value'),
        'associated_notes', public._txt(d, 'associated_notes', 500)
      ))
    );

  elsif p_type = 'general' then
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
    v_has_gst := coalesce((d->>'has_gst')::boolean, false);
    v_base := public._num(d, 'base_amount');
    v_gen_gst := public._num(d, 'gst_amount');
    v_gen_rate := public._num(d, 'gst_rate');
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'base_amount', coalesce(v_base, round(p_amount, 2)),
        'has_gst', v_has_gst,
        'gst_rate', case when v_has_gst then coalesce(v_gen_rate, 18) else 0 end,
        'gst_amount', case when v_has_gst then coalesce(v_gen_gst, round(p_amount - coalesce(v_base, p_amount), 2)) else 0 end,
        'total_amount', round(p_amount, 2)
      ))
    );

  elsif p_type = 'discount' then
    v_before := public._num(d, 'before_amount');
    v_after := public._num(d, 'after_amount');
    if v_before is null or v_before <= 0 then raise exception 'Enter the amount before discount'; end if;
    if v_after is null or v_after < 0 then raise exception 'Enter the amount after discount'; end if;
    if v_after >= v_before then raise exception 'After-discount amount must be less than the amount before discount'; end if;
    return jsonb_build_object(
      'amount', v_before - v_after,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'before_amount', v_before, 'after_amount', v_after,
        'discount_amount', v_before - v_after,
        'discount_pct', round((v_before - v_after) / v_before * 100, 2),
        'customer_name', public._txt(d, 'customer_name', 100),
        'reference', public._txt(d, 'reference', 100),
        'invoice_no', public._txt(d, 'invoice_no', 100),
        'bill_date', public._txt(d, 'bill_date', 50))));

  elsif p_type = 'asset' or p_type = 'asset_below_20k' then
    if public._txt(d, 'asset_name') is null then raise exception 'Asset name is required'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'Enter the quotation amounts'; end if;
    if p_type = 'asset_below_20k' and p_amount > 20000 then
      raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'asset_name', public._txt(d, 'asset_name', 200),
        'quantity', public._txt(d, 'quantity', 50),
        'specification', public._txt(d, 'specification', 1000),
        'purpose', public._txt(d, 'purpose', 1000))));

  elsif p_type = 'stock_transfer' then
    v_mode := public._txt(d, 'transfer_mode', 20);
    if v_mode is null or v_mode not in ('itemized', 'bulk') then
      raise exception 'Stock transfer mode must be itemized or bulk';
    end if;
    if (d->>'from_shop_id') is null or (d->>'to_shop_id') is null then
      raise exception 'Select From Shop and To Shop';
    end if;
    if (d->>'from_shop_id') = (d->>'to_shop_id') then
      raise exception 'From Shop and To Shop cannot be the same';
    end if;

    select name into v_from_shop from public.shops where id = (d->>'from_shop_id')::uuid;
    select name into v_to_shop from public.shops where id = (d->>'to_shop_id')::uuid;

    if v_mode = 'bulk' then
      v_pieces := coalesce((d->>'total_pieces')::int, 0);
      v_gross_wt := round(coalesce((d->>'total_gross_weight')::numeric, 0), 3);
      v_mrp_total := round(coalesce((d->>'total_mrp')::numeric, 0), 2);
      if v_pieces <= 0 then raise exception 'Total pieces count must be at least 1'; end if;
      if v_gross_wt <= 0 then raise exception 'Total gross weight must be greater than 0'; end if;
      if v_mrp_total <= 0 then raise exception 'Total MRP amount must be greater than 0'; end if;
      if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> v_mrp_total then
        raise exception 'Request amount must match total MRP';
      end if;

      return jsonb_build_object(
        'amount', v_mrp_total,
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'bulk',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', coalesce(v_from_shop, d->>'from_shop_name'),
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', coalesce(v_to_shop, d->>'to_shop_name'),
          'category_id', d->>'category_id',
          'category_name', d->>'category_name',
          'total_pieces', v_pieces,
          'total_gross_weight', v_gross_wt,
          'total_mrp', v_mrp_total,
          'notes', public._txt(d, 'notes', 1000)
        ))
      );
    else
      v_items := d->'items';
      if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
        raise exception 'Itemized transfer requires at least one item';
      end if;
      for v_item in select * from jsonb_array_elements(v_items) loop
        v_pieces := v_pieces + 1;
        v_gross_wt := v_gross_wt + round(coalesce((v_item->>'gross_weight')::numeric, 0), 3);
        v_mrp_total := v_mrp_total + round(coalesce((v_item->>'mrp')::numeric, 0), 2);
      end loop;
      if v_mrp_total <= 0 then raise exception 'Total MRP amount must be greater than 0'; end if;

      return jsonb_build_object(
        'amount', round(v_mrp_total, 2),
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'itemized',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', coalesce(v_from_shop, d->>'from_shop_name'),
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', coalesce(v_to_shop, d->>'to_shop_name'),
          'items', v_items,
          'total_pieces', v_pieces,
          'total_gross_weight', round(v_gross_wt, 3),
          'total_mrp', round(v_mrp_total, 2),
          'notes', public._txt(d, 'notes', 1000)
        ))
      );
    end if;

  else
    -- Exhibition
    v_excl := public._num(d, 'amount_excl_gst');
    v_gst_pct := public._num(d, 'gst_pct');
    if v_excl is null or v_excl <= 0 then raise exception 'Amount before GST is required'; end if;
    v_gst := case when (d->>'gst_invoice')::boolean
                  then round(v_excl * coalesce(v_gst_pct, 18) / 100, 2)
                  else 0 end;
    v_total := round(v_excl + v_gst, 2);
    if (d->>'conducting_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
      select name into v_conducting_shop_name
      from public.shops
      where id = (d->>'conducting_shop_id')::uuid;
    end if;
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'conducting_shop_id', public._txt(d, 'conducting_shop_id', 60),
        'conducting_shop_name', coalesce(v_conducting_shop_name, public._txt(d, 'conducting_shop_name', 200)),
        'event_name', public._txt(d, 'event_name', 200),
        'organiser_contact', public._txt(d, 'organiser_contact', 200),
        'venue', public._txt(d, 'venue', 200),
        'event_dates', public._txt(d, 'event_dates', 100),
        'event_start', public._txt(d, 'event_start', 30),
        'event_end', public._txt(d, 'event_end', 30),
        'expected_footfall', public._txt(d, 'expected_footfall', 50),
        'stall_size_location', public._txt(d, 'stall_size_location', 100),
        'amount_excl_gst', v_excl,
        'gst_pct', coalesce(v_gst_pct, 18),
        'gst_amount', v_gst,
        'total_incl_gst', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due', 50),
        'organiser_gstin', public._txt(d, 'organiser_gstin', 20),
        'gst_invoice', coalesce((d->>'gst_invoice')::boolean, false),
        'provides', d->'provides',
        'provides_other', public._txt(d, 'provides_other', 500),
        'voucher_1000_qty', public._int(d, 'voucher_1000_qty'),
        'voucher_500_qty', public._int(d, 'voucher_500_qty'),
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'voucher_validity', public._txt(d, 'voucher_validity', 50),
        'lucky_draw', public._txt(d, 'lucky_draw', 500),
        'winners_draw', public._txt(d, 'winners_draw', 500),
        'other_costs', public._num(d, 'other_costs'),
        'total_budget', public._num(d, 'total_budget'),
        'purpose', public._txt(d, 'purpose', 1000),
        'is_waitlist', coalesce((d->>'is_waitlist')::boolean, false))));
  end if;
end $function$;

grant execute on function public._build_details(public.request_type, numeric, jsonb) to authenticated, anon, service_role;

-- 5. Update create_typed_draft for Petty Cash
create or replace function public.create_typed_draft(
  p_type public.request_type,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb,
  p_target_head_id uuid default null::uuid
)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  v jsonb;
  v_id uuid;
  v_title text;
  v_shop text;
  v_shop_id uuid;
  v_amount numeric;
  v_target_head public.profiles;
  v_dept_id uuid;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_region_id uuid;
  v_region_name text;
  v_is_waitlist boolean;
  v_clean_details jsonb;
  v_bank_details jsonb;
  v_disb_mode text;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (
    p_type::text = 'petty_cash'
    or p_type = any(me.allowed_types)
    or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types))
    or me.role in ('admin', 'head')
  ) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  v_clean_details := coalesce(p_details, '{}'::jsonb) - 'shop_id' - 'shop_name';

  if p_type = 'non_cash' then
    v_amount := 0;
  else
    v := public._build_details(p_type, p_amount, v_clean_details);
    v_amount := (v->>'amount')::numeric;
  end if;

  if p_type = 'asset_below_20k' and v_amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;
  if p_type::text = 'petty_cash' and v_amount > 1000 then
    raise exception 'Petty Cash amount cannot exceed ₹1,000';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type::text = 'petty_cash' then
    v_title := 'Petty Cash: ' || left(coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Expense'), 60);
  end if;
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and p_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Routing / Target Head rules
  if p_type = 'exhibition' then
    if me.default_head_id is not null then
      select * into v_target_head from public.profiles
      where id = me.default_head_id and role = 'head' and is_active;
    end if;
    if v_target_head.id is null and me.department_id is not null then
      select * into v_target_head from public.profiles
      where department_id = me.department_id and role = 'head' and is_active limit 1;
    end if;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  elsif p_type::text = 'petty_cash' then
    if p_target_head_id is not null then
      select * into v_target_head from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;
      if v_target_head.id is null then
        raise exception 'Selected Petty Cash Dealing Head is not active or not found';
      end if;
      if not v_target_head.is_petty_cash_dealer and me.id <> v_target_head.id then
        raise exception 'Selected Department Head is not enabled as a Petty Cash Dealer';
      end if;
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  elsif p_target_head_id is not null then
    select * into v_target_head from public.profiles
    where id = p_target_head_id and role = 'head' and is_active;
    if v_target_head.id is null then raise exception 'The selected Head is not active or not found'; end if;
    v_dept_id := v_target_head.department_id;
    v_owner_head_id := v_target_head.id;
    v_owner_head_name := v_target_head.full_name;
  elsif me.default_head_id is not null then
    select * into v_target_head from public.profiles
    where id = me.default_head_id and role = 'head' and is_active;
    if v_target_head.id is not null then
      v_dept_id := v_target_head.department_id;
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    else
      v_dept_id := me.department_id;
    end if;
  else
    v_dept_id := me.department_id;
  end if;

  -- Shop assignment
  if p_type in ('general', 'non_cash') or p_type::text = 'petty_cash' then
    v_shop_id := public._resolve_request_shop(me, p_details);
  elsif p_type = 'exhibition' then
    v_shop_id := public._resolve_request_shop(
      me,
      case
        when p_details is not null and (p_details ? 'conducting_shop_id')
          then jsonb_build_object('shop_id', p_details->>'conducting_shop_id')
        else p_details
      end
    );
  else
    v_shop_id := me.shop_id;
  end if;
  if v_shop_id is not null then
    select name into v_shop from public.shops where id = v_shop_id;
  end if;

  if p_type = 'exhibition' and v_shop_id is not null then
    v := jsonb_set(
      v,
      '{details}',
      coalesce(v->'details', '{}'::jsonb) || jsonb_build_object(
        'conducting_shop_id', v_shop_id::text,
        'conducting_shop_name', v_shop
      )
    );
  end if;

  if p_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  v_region_id := null;
  v_region_name := null;
  v_is_waitlist := false;
  if p_type = 'exhibition' then
    v_region_id := coalesce(
      me.region_id,
      (select p.region_id from public.profiles p where p.id = me.regional_head_id),
      case when p_details ? 'region_id' and p_details->>'region_id' ~ '^[0-9a-fA-F-]{36}$'
           then (p_details->>'region_id')::uuid else null end
    );
    if v_region_id is not null then
      select name into v_region_name from public.regions where id = v_region_id;
    end if;
    v_is_waitlist := coalesce((p_details->>'is_waitlist')::boolean, false);
  end if;

  v_disb_mode := nullif(coalesce(p_details, '{}'::jsonb)->>'disbursement_mode', '');
  if p_type::text = 'petty_cash' and v_disb_mode is null then
    v_disb_mode := 'cash';
  end if;

  v_bank_details := jsonb_strip_nulls(jsonb_build_object(
    'disbursement_mode', v_disb_mode,
    'enter_bank_details_later', coalesce((coalesce(p_details, '{}'::jsonb)->>'enter_bank_details_later')::boolean, false),
    'bank_account_no', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_no', ''),
    'bank_ifsc', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_ifsc', ''),
    'bank_name', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_name', ''),
    'bank_branch', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_branch', ''),
    'bank_account_holder_name', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_holder_name', ''),
    'bank_verified', coalesce((coalesce(p_details, '{}'::jsonb)->>'bank_verified')::boolean, false),
    'bank_verification_message', nullif(coalesce(p_details, '{}'::jsonb)->>'bank_verification_message', '')
  ));

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name,
    region_id, region_name, is_waitlist,
    disbursement_mode, enter_bank_details_later, bank_account_no, bank_ifsc,
    bank_name, bank_branch, bank_account_holder_name, bank_verified, bank_verification_message
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, v_shop_id, v_shop,
    (case when p_type = 'non_cash' then v_clean_details else v->'details' end) || v_bank_details,
    v_owner_head_id, v_owner_head_name,
    v_region_id, v_region_name, v_is_waitlist,
    v_disb_mode,
    coalesce((coalesce(p_details, '{}'::jsonb)->>'enter_bank_details_later')::boolean, false),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_no', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_ifsc', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_name', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_branch', ''),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_holder_name', ''),
    coalesce((coalesce(p_details, '{}'::jsonb)->>'bank_verified')::boolean, false),
    nullif(coalesce(p_details, '{}'::jsonb)->>'bank_verification_message', '')
  )
  returning id into v_id;

  return v_id;
end $function$;

revoke execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) from public, anon;
grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;

-- 6. Update update_typed_draft for Petty Cash
create or replace function public.update_typed_draft(
  p_request_id uuid,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb
)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  v jsonb;
  v_title text;
  v_shop_id uuid;
  v_shop_name text;
  v_clean_details jsonb;
  v_bank_details jsonb;
  v_can_edit boolean := false;
  v_disb_mode text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if r.requester_id = me.id and r.status in ('draft', 'returned') then
    v_can_edit := true;
  elsif r.status = 'returned' and (
    me.role = 'admin'
    or (me.role in ('head', 'clerk') and (r.department_id = me.department_id or r.owner_head_id = me.id))
    or (me.role = 'regional_head' and (r.regional_head_id = me.id or r.department_id = me.department_id))
  ) then
    v_can_edit := true;
  end if;

  if not v_can_edit then
    raise exception 'You do not have permission to edit this request';
  end if;

  v_clean_details := case when p_details is null then null else p_details - 'shop_id' - 'shop_name' end;

  if r.request_type <> 'non_cash' then
    v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(v_clean_details, r.details));
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type::text = 'petty_cash' then
    v_title := 'Petty Cash: ' || left(coalesce(nullif(btrim(coalesce(p_notes, r.notes, '')), ''), 'Expense'), 60);
  end if;
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and r.request_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  v_shop_id := r.shop_id;
  v_shop_name := r.shop_name;

  if (r.request_type in ('general', 'non_cash') or r.request_type::text = 'petty_cash') and p_details is not null and p_details ? 'shop_id' then
    v_shop_id := public._resolve_request_shop(me, p_details);
    select name into v_shop_name from public.shops where id = v_shop_id;
  elsif r.request_type = 'exhibition' and p_details is not null and (p_details ? 'conducting_shop_id' or p_details ? 'shop_id') then
    if me.role in ('admin', 'head', 'clerk') or me.id <> r.requester_id then
      if coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id') ~ '^[0-9a-fA-F-]{36}$' then
        v_shop_id := (coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id'))::uuid;
      end if;
    else
      v_shop_id := public._resolve_request_shop(
        me,
        jsonb_build_object('shop_id', coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id'))
      );
    end if;
    select name into v_shop_name from public.shops where id = v_shop_id;
    if v_shop_id is not null and v_shop_name is not null then
      v := jsonb_set(
        v,
        '{details}',
        coalesce(v->'details', '{}'::jsonb) || jsonb_build_object(
          'conducting_shop_id', v_shop_id::text,
          'conducting_shop_name', v_shop_name
        )
      );
    end if;
  elsif (r.request_type in ('general', 'non_cash') or r.request_type::text = 'petty_cash') and v_shop_id is null then
    v_shop_id := public._resolve_request_shop(me, null);
    select name into v_shop_name from public.shops where id = v_shop_id;
  end if;

  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  v_disb_mode := case
    when p_details is not null and (p_details ? 'disbursement_mode') then nullif(p_details->>'disbursement_mode', '')
    else r.disbursement_mode
  end;
  if r.request_type::text = 'petty_cash' and v_disb_mode is null then
    v_disb_mode := 'cash';
  end if;

  v_bank_details := jsonb_strip_nulls(jsonb_build_object(
    'disbursement_mode', v_disb_mode,
    'enter_bank_details_later', case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end,
    'bank_account_no', case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end,
    'bank_ifsc', case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end,
    'bank_name', case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end,
    'bank_branch', case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end,
    'bank_account_holder_name', case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end,
    'bank_verified', case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end,
    'bank_verification_message', case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end
  ));

  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type = 'non_cash' then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = (case when r.request_type = 'non_cash' then coalesce(v_clean_details, r.details) else v->'details' end) || v_bank_details,
    shop_id = v_shop_id,
    shop_name = v_shop_name,
    disbursement_mode = v_disb_mode,
    enter_bank_details_later = case when p_details ? 'enter_bank_details_later' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else coalesce(r.enter_bank_details_later, false) end,
    bank_account_no = case when p_details ? 'bank_account_no' then nullif(p_details->>'bank_account_no', '') else r.bank_account_no end,
    bank_ifsc = case when p_details ? 'bank_ifsc' then nullif(p_details->>'bank_ifsc', '') else r.bank_ifsc end,
    bank_name = case when p_details ? 'bank_name' then nullif(p_details->>'bank_name', '') else r.bank_name end,
    bank_branch = case when p_details ? 'bank_branch' then nullif(p_details->>'bank_branch', '') else r.bank_branch end,
    bank_account_holder_name = case when p_details ? 'bank_account_holder_name' then nullif(p_details->>'bank_account_holder_name', '') else r.bank_account_holder_name end,
    bank_verified = case when p_details ? 'bank_verified' then coalesce((p_details->>'bank_verified')::boolean, false) else coalesce(r.bank_verified, false) end,
    bank_verification_message = case when p_details ? 'bank_verification_message' then nullif(p_details->>'bank_verification_message', '') else r.bank_verification_message end,
    updated_at = now()
  where id = r.id;

  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;

revoke execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) from public, anon;
grant execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) to authenticated;

-- 7. Update set_request_target_head to enforce Petty Cash Dealer flag on petty_cash
create or replace function public.set_request_target_head(p_request_id uuid, p_head_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  h public.profiles;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft', 'returned') then raise exception 'Cannot change Head after submission'; end if;

  select * into h from public.profiles where id = p_head_id and role = 'head' and is_active;
  if h.id is null then raise exception 'Invalid or inactive Head'; end if;
  if r.request_type::text = 'petty_cash' and not h.is_petty_cash_dealer and me.id <> h.id then
    raise exception 'Selected Department Head is not enabled as a Petty Cash Dealer';
  end if;

  update public.requests
  set owner_head_id = h.id,
      owner_head_name = h.full_name,
      department_id = h.department_id,
      category_id = case
        when r.request_type::text = 'petty_cash' then null
        when exists (select 1 from public.work_categories where id = r.category_id and department_id = h.department_id and is_active) then r.category_id
        else null
      end,
      category_name = case
        when r.request_type::text = 'petty_cash' then null
        when exists (select 1 from public.work_categories where id = r.category_id and department_id = h.department_id and is_active) then r.category_name
        else null
      end,
      updated_at = now()
  where id = r.id;
end $$;

revoke execute on function public.set_request_target_head(uuid, uuid) from public, anon;
grant execute on function public.set_request_target_head(uuid, uuid) to authenticated;

-- 8. Update assign_disbursement_entry_user so Requester (draft/returned), Regional Head, Head, Clerk, and Admin can assign/edit Entry Account
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
  is_requester_draft boolean;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  is_requester_draft := (r.requester_id = me.id and r.status in ('draft', 'returned'));

  if not is_requester_draft and me.role not in ('admin', 'head', 'regional_head', 'clerk') then
    raise exception 'Permission denied: Only the requester (before submit), Regional Head, Department Head, Clerk, or Admin can assign the disbursement entry account';
  end if;
  if not is_requester_draft and me.role = 'clerk' and me.department_id is distinct from r.department_id then
    raise exception 'Permission denied: Clerks can only assign entry accounts for their own department';
  end if;

  if r.status in ('cancelled', 'rejected', 'withdrawn') then
    raise exception 'Cannot assign entry account on a % request', r.status;
  end if;

  if r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Disbursement entry accounts cannot be assigned to non-payment requests';
  end if;

  select count(*) into entry_count
    from public.disbursement_entries
   where request_id = r.id and status <> 'cancelled';

  if entry_count > 0 then
    raise exception 'Selection locked: A disbursement entry has already been created for this request. Entry account cannot be changed.';
  end if;

  select * into target_user from public.profiles where id = p_entry_user_id and is_active;
  if target_user.id is null then
    raise exception 'Target disbursement user not found or inactive';
  end if;
  if target_user.role <> 'disbursement'
     or target_user.disbursement_type is distinct from 'entry_only'
     or (lower(coalesce(target_user.designation, '')) ~ '(approv|check|verif|review|audit)')
     or (lower(coalesce(target_user.username, '')) ~ '(approv|check|verif|review|audit)')
     or (lower(coalesce(target_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
    raise exception 'Assigned user must be an active Disbursement Entry Only account (Entry Checking / Approver accounts cannot be assigned)';
  end if;

  update public.requests
     set assigned_entry_user_id = target_user.id,
         assigned_entry_user_name = target_user.full_name,
         assigned_entry_at = now(),
         assigned_entry_by = me.id,
         updated_at = now()
   where id = r.id;

  if r.status <> 'draft' then
    perform public._log_action(
      r.id, me, 'assigned_entry_account', r.status, r.status,
      'Assigned Disbursement Entry account to ' || target_user.full_name,
      true
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'request_id', r.id,
    'assigned_entry_user_id', target_user.id,
    'assigned_entry_user_name', target_user.full_name
  );
end $$;

revoke execute on function public.assign_disbursement_entry_user(uuid, uuid) from public, anon;
grant execute on function public.assign_disbursement_entry_user(uuid, uuid) to authenticated;

-- 9. Update submit_request with Petty Cash clerk-skipping routing
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
  pc_head public.profiles;
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
      -- Head raising own Petty Cash request without another dealer Head -> Admin
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

    -- Resolve Regional Head if Employee
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
      -- Employee WITH Regional Head -> Regional Head first (who then forwards directly to Head skipping clerk)
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

      perform public._log_action(r.id, me, 'submitted', r.status, 'pending_regional_review',
        'Petty Cash submitted to Regional Head (Target Head: ' || pc_head.full_name || ')', true);
      perform public.notify_next_actor(r.id, 'pending_regional_review');
      return;

    elsif pc_head.id is not null then
      -- Employee WITHOUT Regional Head, OR Regional Head, OR Clerk, OR Head targeting another Petty Cash Dealer:
      -- SKIPS CLERK -> Directly to Petty Cash Dealing Head!
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

      perform public._log_action(r.id, me, 'submitted', r.status, 'pending_head_approval',
        'Petty Cash routed directly to ' || pc_head.full_name || ' (clerk skipped)', true);
      perform public.notify_next_actor(r.id, 'pending_head_approval');
      return;

    else
      -- Own Head Petty Cash -> Admin
      update public.requests set
        status = 'pending_admin_approval',
        request_no = v_no,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
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
        'Department Head Petty Cash routed directly to Admin for approval', true);
      perform public.notify_next_actor(r.id, 'pending_admin_approval');
      return;
    end if;
  end if;

  -- Non-Petty-Cash standard validation & routing
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

-- 10. Update regional_forward_request:
--     - Supports optional p_assigned_entry_user_id so Regional Head can edit Entry Account on forward
--     - For petty_cash: chooses/validates Petty Cash Dealing Head, skips clerk & category,
--       and forwards DIRECTLY to pending_head_approval (Route B)!
drop function if exists public.regional_forward_request(uuid, text);
drop function if exists public.regional_forward_request(uuid, text, uuid, uuid);
drop function if exists public.regional_forward_request(uuid, text, uuid, uuid, uuid);

create or replace function public.regional_forward_request(
  p_request_id uuid,
  p_remarks text default null,
  p_target_head_id uuid default null,
  p_category_id uuid default null,
  p_assigned_entry_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  r public.requests;
  v_target_head public.profiles;
  v_entry_user public.profiles;
  v_owner_head_id uuid;
  v_owner_head_name text;
  v_dept_id uuid;
  v_cat_id uuid;
  v_cat_name text;
  v_entry_id uuid;
  v_entry_name text;
  v_entry_count int;
  v_head_changed boolean := false;
  v_final_remarks text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or not public.can_view_request(r.id) then
    raise exception 'Not found';
  end if;
  if r.status <> 'pending_regional_review' then
    raise exception 'This request is not waiting for the Regional Head';
  end if;
  if not public._is_regional_actor(r, me) then
    raise exception 'Only the assigned Regional Head can forward this request';
  end if;

  v_owner_head_id := r.owner_head_id;
  v_owner_head_name := r.owner_head_name;
  v_dept_id := r.department_id;
  v_cat_id := r.category_id;
  v_cat_name := r.category_name;
  v_entry_id := r.assigned_entry_user_id;
  v_entry_name := r.assigned_entry_user_name;

  -- Optional update of Disbursement Entry Account by Regional Head
  if p_assigned_entry_user_id is not null and r.request_type not in ('discount', 'non_cash', 'stock_transfer') then
    if p_assigned_entry_user_id is distinct from r.assigned_entry_user_id then
      select count(*) into v_entry_count
        from public.disbursement_entries
       where request_id = r.id and status <> 'cancelled';
      if v_entry_count > 0 then
        raise exception 'A disbursement entry has already been created; entry account cannot be changed.';
      end if;

      select * into v_entry_user from public.profiles where id = p_assigned_entry_user_id and is_active;
      if v_entry_user.id is null
         or v_entry_user.role <> 'disbursement'
         or v_entry_user.disbursement_type is distinct from 'entry_only'
         or (lower(coalesce(v_entry_user.designation, '')) ~ '(approv|check|verif|review|audit)')
         or (lower(coalesce(v_entry_user.username, '')) ~ '(approv|check|verif|review|audit)')
         or (lower(coalesce(v_entry_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
        raise exception 'Selected user must be an active Disbursement Entry Only account';
      end if;

      v_entry_id := v_entry_user.id;
      v_entry_name := v_entry_user.full_name;
    end if;
  end if;

  -- PETTY CASH BRANCH: Choose Petty Cash Dealing Head & forward DIRECTLY to Head (skip clerk!)
  if r.request_type::text = 'petty_cash' then
    if p_target_head_id is not null and p_target_head_id is distinct from r.owner_head_id then
      select * into v_target_head
      from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;

      if v_target_head.id is null or not v_target_head.is_petty_cash_dealer then
        raise exception 'Selected Department Head is not an active Petty Cash Dealer';
      end if;

      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
      v_dept_id := v_target_head.department_id;
      v_head_changed := true;
    else
      select * into v_target_head
      from public.profiles
      where id = v_owner_head_id and role = 'head' and is_active;

      if v_target_head.id is null or not v_target_head.is_petty_cash_dealer then
        raise exception 'Please select an active Petty Cash Dealing Head before forwarding';
      end if;
      v_owner_head_name := v_target_head.full_name;
      v_dept_id := v_target_head.department_id;
    end if;

    if v_entry_id is null then
      raise exception 'Please select a Disbursement Entry Account before forwarding Petty Cash';
    end if;

    update public.requests
    set status = 'pending_head_approval'::public.request_status,
        route = 'B'::public.approval_route,
        routed_by = me.id,
        routed_at = now(),
        owner_head_id = v_owner_head_id,
        owner_head_name = v_owner_head_name,
        department_id = v_dept_id,
        category_id = null,
        category_name = null,
        assigned_entry_user_id = v_entry_id,
        assigned_entry_user_name = v_entry_name,
        assigned_entry_at = case when v_entry_id is distinct from r.assigned_entry_user_id then now() else r.assigned_entry_at end,
        assigned_entry_by = case when v_entry_id is distinct from r.assigned_entry_user_id then me.id else r.assigned_entry_by end,
        regional_forwarded_at = now(),
        updated_at = now()
    where id = r.id;

    if nullif(btrim(coalesce(p_remarks, '')), '') is not null then
      v_final_remarks := '[Forwarded directly to Petty Cash Head ' || v_owner_head_name || ' · clerk skipped] ' || btrim(p_remarks);
    else
      v_final_remarks := 'Forwarded directly to Petty Cash Head ' || v_owner_head_name || ' (clerk skipped)';
    end if;

    perform public._log_action(r.id, me, 'regional_forwarded', r.status, 'pending_head_approval', v_final_remarks, true);
    perform public.notify_next_actor(r.id, 'pending_head_approval'::public.request_status);
    return;
  end if;

  -- STANDARD NON-PETTY-CASH BRANCH (routes to Clerk via 'submitted')
  if p_target_head_id is not null and r.request_type <> 'exhibition'::public.request_type then
    if p_target_head_id is distinct from r.owner_head_id then
      select * into v_target_head
      from public.profiles
      where id = p_target_head_id and role = 'head' and is_active;

      if v_target_head.id is null then
        raise exception 'Selected Department Head is invalid or inactive';
      end if;

      if me.role = 'regional_head' then
        if not (
          p_target_head_id = me.default_head_id
          or exists (
            select 1 from public.user_heads uh
            where uh.user_id = me.id and uh.head_id = p_target_head_id
          )
          or (
            me.default_head_id is null
            and v_target_head.department_id = me.department_id
            and not exists (select 1 from public.user_heads uh2 where uh2.user_id = me.id)
          )
        ) then
          raise exception 'You are not allowed to forward requests to this Department Head';
        end if;
      end if;

      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
      v_dept_id := v_target_head.department_id;
      v_head_changed := true;
    end if;
  end if;

  if p_category_id is not null and r.request_type <> 'exhibition'::public.request_type then
    select c.id, c.name into v_cat_id, v_cat_name
    from public.work_categories c
    where c.id = p_category_id
      and c.department_id = v_dept_id
      and c.is_active;

    if v_cat_id is null then
      raise exception 'Selected work category does not belong to the chosen Department Head''s department';
    end if;
  elsif v_cat_id is not null then
    if not exists (
      select 1 from public.work_categories c
      where c.id = v_cat_id and c.department_id = v_dept_id and c.is_active
    ) then
      v_cat_id := null;
      v_cat_name := null;
    end if;
  end if;

  if r.request_type <> 'exhibition'::public.request_type
     and public._category_required(v_dept_id)
     and v_cat_id is null then
    raise exception 'Select the work category for the chosen Department Head';
  end if;

  update public.requests
  set status = 'submitted'::public.request_status,
      owner_head_id = v_owner_head_id,
      owner_head_name = v_owner_head_name,
      department_id = v_dept_id,
      category_id = v_cat_id,
      category_name = v_cat_name,
      assigned_entry_user_id = v_entry_id,
      assigned_entry_user_name = v_entry_name,
      assigned_entry_at = case when v_entry_id is distinct from r.assigned_entry_user_id then now() else r.assigned_entry_at end,
      assigned_entry_by = case when v_entry_id is distinct from r.assigned_entry_user_id then me.id else r.assigned_entry_by end,
      regional_forwarded_at = now(),
      updated_at = now()
  where id = r.id;

  if v_head_changed then
    if nullif(btrim(coalesce(p_remarks, '')), '') is not null then
      v_final_remarks := '[Directed to ' || v_owner_head_name || '] ' || btrim(p_remarks);
    else
      v_final_remarks := 'Directed to ' || v_owner_head_name;
    end if;
  else
    v_final_remarks := nullif(btrim(coalesce(p_remarks, '')), '');
  end if;

  perform public._log_action(r.id, me, 'regional_forwarded', r.status, 'submitted', v_final_remarks, true);
  perform public.notify_next_actor(r.id, 'submitted'::public.request_status);
end $$;

revoke execute on function public.regional_forward_request(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.regional_forward_request(uuid, text, uuid, uuid, uuid) to authenticated;

-- 11. Helper RPC to sync Petty_Cash_Form_Below_1000.pdf onto request_files at sort_order = -1
create or replace function public.sync_petty_cash_form_file(
  p_request_id uuid,
  p_storage_path text,
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
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.request_type::text <> 'petty_cash' then
    raise exception 'Only Petty Cash requests use Petty Cash Form Below 1000';
  end if;
  if r.status in ('approved', 'rejected', 'paid', 'withdrawn', 'cancelled') then
    raise exception 'Cannot modify files on a finalized request';
  end if;

  if not (
    r.requester_id = me.id
    or me.role = 'admin'
    or (me.role = 'head' and (r.owner_head_id = me.id or r.department_id = me.department_id))
    or (me.role = 'regional_head' and r.regional_head_id = me.id)
  ) then
    raise exception 'Not authorized to sync Petty Cash form';
  end if;

  if public.storage_request_id(p_storage_path) is distinct from r.id then
    raise exception 'Bad file path';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'request-files' and name = p_storage_path) then
    raise exception 'Petty Cash form file was not uploaded';
  end if;

  delete from public.request_files
  where request_id = r.id
    and kind = 'document'
    and lower(original_name) like 'petty_cash_form_below_1000%';

  insert into public.request_files (
    request_id, kind, storage_path, original_name, mime_type, size_bytes,
    page_count, sort_order, added_by, added_by_name, added_by_role
  )
  values (
    r.id, 'document', p_storage_path, 'Petty_Cash_Form_Below_1000.pdf',
    'application/pdf', p_size_bytes, greatest(1, coalesce(p_page_count, 1)), -1,
    null, null, null
  )
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.sync_petty_cash_form_file(uuid, text, bigint, int) from public, anon;
grant execute on function public.sync_petty_cash_form_file(uuid, text, bigint, int) to authenticated;

-- 12. Update begin_approval so Petty Cash Dealing Head can approve and return Petty Cash metadata
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

  if (r.request_type = 'asset' or r.request_type = 'asset_below_20k') and r.selected_quote_id is null then
    raise exception 'Select the best quotation before approving';
  end if;

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

notify pgrst, 'reload schema';
