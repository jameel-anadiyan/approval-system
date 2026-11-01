-- ============================================================================
-- 0072_exhibition_conducting_shop.sql
--
-- Adds Conducting Shop support to Exhibition / Event Sponsorship requests:
-- 1. Stores `conducting_shop_id` and `conducting_shop_name` inside `requests.details`
--    for new/edited Exhibition requests (under "1 Event details").
-- 2. Validates the selected conducting shop against `public._resolve_request_shop`
--    so Employees can pick strictly from their assigned shop(s) and Regional Heads
--    can pick strictly from the shops under that Regional Head.
-- 3. Leaves pre-existing / already-proceeded exhibition requests untouched so
--    `details.conducting_shop_name` remains unset and displays as "Not Assigned".
-- ============================================================================

-- 1. Update _build_details to preserve conducting_shop_id & conducting_shop_name on exhibition
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
  if p_type = 'non_cash' then
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

-- 2. Update create_typed_draft to resolve & validate conducting shop for exhibition
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
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (p_type = any(me.allowed_types) or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  -- The shop choice travels inside p_details; never store generic shop_id/shop_name in typed details.
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

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (p_type = 'asset' or p_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and p_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and p_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  -- Routing rules:
  -- For exhibition requests: STRICTLY to Main Head only, NO choosing.
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
  if p_type in ('general', 'non_cash') then
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

  v_bank_details := jsonb_strip_nulls(jsonb_build_object(
    'disbursement_mode', nullif(coalesce(p_details, '{}'::jsonb)->>'disbursement_mode', ''),
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
    nullif(coalesce(p_details, '{}'::jsonb)->>'disbursement_mode', ''),
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

-- 3. Update update_typed_draft to preserve/update conducting shop on exhibition edits
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
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request can no longer be edited'; end if;

  v_clean_details := case when p_details is null then null else p_details - 'shop_id' - 'shop_name' end;

  if r.request_type <> 'non_cash' then
    v := public._build_details(r.request_type, coalesce(p_amount, r.amount), coalesce(v_clean_details, r.details));
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and r.request_type = 'exhibition' then v_title := 'Exhibition: ' || (v->'details'->>'event_name'); end if;
  if v_title is null and (r.request_type = 'asset' or r.request_type = 'asset_below_20k') then v_title := 'Asset: ' || (v->'details'->>'asset_name'); end if;
  if v_title is null and r.request_type = 'non_cash' then v_title := 'Non-Cash Request'; end if;
  if v_title is null and r.request_type = 'stock_transfer' then
    v_title := 'Stock Transfer: ' || coalesce(v->'details'->>'from_shop_name', 'Shop') || ' → ' || coalesce(v->'details'->>'to_shop_name', 'Shop');
  end if;
  if v_title is null then raise exception 'Title is required'; end if;

  v_shop_id := r.shop_id;
  v_shop_name := r.shop_name;

  if r.request_type in ('general', 'non_cash') and p_details is not null and p_details ? 'shop_id' then
    v_shop_id := public._resolve_request_shop(me, p_details);
    select name into v_shop_name from public.shops where id = v_shop_id;
  elsif r.request_type = 'exhibition' and p_details is not null and (p_details ? 'conducting_shop_id' or p_details ? 'shop_id') then
    v_shop_id := public._resolve_request_shop(
      me,
      jsonb_build_object('shop_id', coalesce(nullif(p_details->>'conducting_shop_id', ''), p_details->>'shop_id'))
    );
    select name into v_shop_name from public.shops where id = v_shop_id;
    if v_shop_id is not null then
      v := jsonb_set(
        v,
        '{details}',
        coalesce(v->'details', '{}'::jsonb) || jsonb_build_object(
          'conducting_shop_id', v_shop_id::text,
          'conducting_shop_name', v_shop_name
        )
      );
    end if;
  elsif r.request_type in ('general', 'non_cash') and v_shop_id is null then
    v_shop_id := public._resolve_request_shop(me, null);
    select name into v_shop_name from public.shops where id = v_shop_id;
  end if;

  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  -- Build bank details to preserve / update
  v_bank_details := jsonb_strip_nulls(jsonb_build_object(
    'disbursement_mode', case when p_details ? 'disbursement_mode' then nullif(p_details->>'disbursement_mode', '') else r.disbursement_mode end,
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
    disbursement_mode = case when p_details ? 'disbursement_mode' then nullif(p_details->>'disbursement_mode', '') else r.disbursement_mode end,
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

notify pgrst, 'reload schema';
