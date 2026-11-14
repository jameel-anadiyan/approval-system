-- ============================================================================
-- apply_0103: Petty Cash category limits (Showroom ₹4,000 · Accommodation ₹1,500 ·
--             Water Bottle ₹2,500 · Normal ₹1,000)
-- ----------------------------------------------------------------------------
-- Symptom: every Petty Cash request is blocked above ₹1,000 even when the
-- category allows more. Cause: the live database still has the old
-- _build_details() (from 0076/0080) with a hard-coded "amount > 1000" check and
-- it drops the petty_cash_category, so submit_request() also falls back to
-- 'normal' (₹1,000).
--
-- Run this whole file in Supabase Dashboard -> SQL Editor. It is idempotent.
-- The final SELECT shows a check-list; every row must say ok = true.
-- ============================================================================

create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
  v_unrounded numeric; v_round_off numeric := 0;
  v_mode text;
  v_items jsonb;
  v_item jsonb;
  v_pieces int := 0;
  v_gross_wt numeric := 0;
  v_mrp_total numeric := 0;
  v_from_shop text;
  v_to_shop text;
  v_conducting_shop_name text;
  v_pay_date text;
  v_due_date text;
  v_audit_from text;
  v_audit_to text;
  v_audit_firm text;
  v_pc_cat text;
  v_pc_limit numeric;
  v_bottle_qty int;
  v_per_price numeric;
begin
  if p_type::text = 'agreement' then
    return jsonb_build_object(
      'amount', 0,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'description', public._txt(d, 'description', 4000)
      ))
    );

  elsif p_type::text = 'statutory_payment' then
    if p_amount is null or p_amount <= 0 then
      raise exception 'Payment amount must be greater than zero';
    end if;
    v_pay_date := public._txt(d, 'payment_date', 40);
    v_due_date := public._txt(d, 'due_date', 40);
    if v_pay_date is null then
      raise exception 'Payment date is required for Statutory Payment requests';
    end if;
    if v_due_date is null then
      raise exception 'Due date is required for Statutory Payment requests';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'payment_amount', round(p_amount, 2),
        'payment_date', v_pay_date,
        'due_date', v_due_date,
        'description', public._txt(d, 'description', 4000)
      ))
    );

  elsif p_type::text = 'audit_report' then
    v_audit_from := public._txt(d, 'audit_from_date', 40);
    v_audit_to := public._txt(d, 'audit_to_date', 40);
    v_audit_firm := public._txt(d, 'audit_firm', 250);
    if v_audit_from is null then
      raise exception 'Audit period From date is required';
    end if;
    if v_audit_to is null then
      raise exception 'Audit period To date is required';
    end if;
    if v_audit_to < v_audit_from then
      raise exception 'Audit period To date cannot be earlier than From date';
    end if;
    if v_audit_firm is null then
      raise exception 'Please enter the firm name (Audit Report of Which Firm)';
    end if;
    return jsonb_build_object(
      'amount', 0,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'audit_from_date', v_audit_from,
        'audit_to_date', v_audit_to,
        'audit_firm', v_audit_firm,
        'description', public._txt(d, 'description', 4000)
      ))
    );

  elsif p_type::text = 'petty_cash' then
    v_pc_cat := coalesce(d->>'petty_cash_category', 'normal');
    v_bottle_qty := public._int(d, 'bottle_qty');

    if v_pc_cat = 'showroom_cleaning' then
      v_pc_limit := 4000;
    elsif v_pc_cat = 'accommodation_cleaning' then
      v_pc_limit := 1500;
    elsif v_pc_cat = 'water_bottle' then
      v_pc_limit := 2500;
      if v_bottle_qty is not null and v_bottle_qty > 0 then
        v_per_price := round(p_amount / v_bottle_qty, 2);
        if v_per_price > 6.00 then
          raise exception 'Bottle price is high (₹%/bottle, maximum ₹6 allowed). Please put this in general request', v_per_price;
        end if;
      end if;
    else
      v_pc_cat := 'normal';
      v_pc_limit := 1000;
    end if;

    if p_amount is null or p_amount <= 0 then
      raise exception 'Amount must be greater than zero';
    end if;
    if p_amount > v_pc_limit then
      raise exception 'Amount cannot exceed ₹% for %', v_pc_limit, v_pc_cat;
    end if;

    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'petty_cash_form', 'petty_cash_form_below_1000',
        'petty_cash_category', v_pc_cat,
        'max_limit', v_pc_limit,
        'bottle_qty', v_bottle_qty,
        'per_bottle_price', v_per_price,
        'total_amount', round(p_amount, 2),
        'description', public._txt(d, 'description', 4000)
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

    if v_has_gst then
      v_unrounded := coalesce(v_base, 0) + coalesce(v_gen_gst, 0);
      v_total := round(v_unrounded, 0); -- Rounded to nearest ₹1
      v_round_off := round(v_total - v_unrounded, 2);
    else
      v_total := round(coalesce(v_base, p_amount), 0);
      v_round_off := 0;
    end if;

    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'base_amount', v_base,
        'has_gst', v_has_gst,
        'gst_rate', case when v_has_gst then coalesce(v_gen_rate, case when v_base > 0 and v_gen_gst > 0 then round((v_gen_gst / v_base) * 100, 2) else 18 end) else 0 end,
        'gst_amount', case when v_has_gst then v_gen_gst else 0 end,
        'round_off', v_round_off,
        'total_amount', v_total)));

  elsif p_type = 'discount' then
    v_before := public._num(d, 'bill_amount_before_discount');
    v_after := public._num(d, 'bill_amount_after_discount');
    if v_before is null or v_before <= 0 then raise exception 'Bill amount before discount is required'; end if;
    if v_after is null or v_after < 0 then raise exception 'Bill amount after discount is required'; end if;
    if v_after >= v_before then raise exception 'Amount after discount must be strictly less than before discount'; end if;
    return jsonb_build_object(
      'amount', round(v_before - v_after, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'customer_name', public._txt(d, 'customer_name', 200),
        'customer_phone', public._txt(d, 'customer_phone', 40),
        'bill_amount_before_discount', v_before,
        'bill_amount_after_discount', v_after,
        'discount_amount', round(v_before - v_after, 2),
        'discount_pct', round(((v_before - v_after) / v_before) * 100, 2),
        'reason', public._txt(d, 'reason', 1000))));

  elsif p_type = 'asset' or p_type = 'asset_below_20k' then
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
    if p_type = 'asset_below_20k' and p_amount > 20000 then
      raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
    end if;
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'asset_name', public._txt(d, 'asset_name', 200),
        'category', public._txt(d, 'category', 100),
        'reason', public._txt(d, 'reason', 1000),
        'selected_quote_id', public._txt(d, 'selected_quote_id', 100),
        'admin_choice_override', coalesce((d->>'admin_choice_override')::boolean, false))));

  elsif p_type = 'stock_transfer' then
    v_mode := coalesce(d->>'transfer_mode', 'quick');
    if v_mode = 'quick' then
      v_pieces := public._int(d, 'total_pieces');
      v_gross_wt := public._num(d, 'total_gross_weight');
      v_mrp_total := public._num(d, 'total_mrp');
      if v_pieces is null or v_pieces <= 0 then raise exception 'Total pieces must be at least 1'; end if;
      if v_gross_wt is null or v_gross_wt <= 0 then raise exception 'Total gross weight must be greater than zero'; end if;
      if v_mrp_total is null or v_mrp_total <= 0 then raise exception 'Total MRP must be greater than zero'; end if;

      if (d->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
        select name into v_from_shop from public.shops where id = (d->>'from_shop_id')::uuid;
      end if;
      if (d->>'to_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
        select name into v_to_shop from public.shops where id = (d->>'to_shop_id')::uuid;
      end if;

      return jsonb_build_object(
        'amount', round(v_mrp_total, 2),
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'quick',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', coalesce(v_from_shop, d->>'from_shop_name'),
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', coalesce(v_to_shop, d->>'to_shop_name'),
          'total_pieces', v_pieces,
          'total_gross_weight', round(v_gross_wt, 3),
          'total_mrp', round(v_mrp_total, 2),
          'notes', public._txt(d, 'notes', 1000)
        ))
      );
    else
      v_items := coalesce(d->'items', '[]'::jsonb);
      if jsonb_array_length(v_items) = 0 then
        raise exception 'At least one item is required for itemized stock transfer';
      end if;

      v_pieces := jsonb_array_length(v_items);
      v_gross_wt := 0;
      v_mrp_total := 0;

      for v_item in select * from jsonb_array_elements(v_items) loop
        if coalesce((v_item->>'mrp')::numeric, 0) <= 0 then
          raise exception 'Each item in stock transfer must have an MRP greater than zero';
        end if;
        if coalesce((v_item->>'gross_weight')::numeric, 0) <= 0 then
          raise exception 'Each item in stock transfer must have gross weight greater than zero';
        end if;
        v_mrp_total := v_mrp_total + (v_item->>'mrp')::numeric;
        v_gross_wt := v_gross_wt + (v_item->>'gross_weight')::numeric;
      end loop;

      if (d->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
        select name into v_from_shop from public.shops where id = (d->>'from_shop_id')::uuid;
      end if;
      if (d->>'to_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
        select name into v_to_shop from public.shops where id = (d->>'to_shop_id')::uuid;
      end if;

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
    -- Exhibition: preserve daily_schedules, total_days, total_hours
    v_excl := public._num(d, 'amount_excl_gst');
    v_gst_pct := public._num(d, 'gst_pct');
    v_gen_gst := public._num(d, 'gst_amount');
    if v_excl is null or v_excl <= 0 then raise exception 'Amount before GST is required'; end if;
    v_gst := case when (d->>'gst_invoice')::boolean
                  then coalesce(v_gen_gst, round(v_excl * coalesce(v_gst_pct, 18) / 100, 2))
                  else 0 end;
    v_unrounded := v_excl + v_gst;
    v_total := round(v_unrounded, 0); -- Nearest ₹1 standard rounding
    v_round_off := round(v_total - v_unrounded, 2);

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
        'daily_schedules', d->'daily_schedules',
        'total_days', coalesce(public._int(d, 'total_days'), jsonb_array_length(coalesce(d->'daily_schedules', '[]'::jsonb))),
        'total_hours', public._num(d, 'total_hours'),
        'expected_footfall', public._txt(d, 'expected_footfall', 50),
        'stall_size_location', public._txt(d, 'stall_size_location', 100),
        'amount_excl_gst', v_excl,
        'gst_pct', case when v_excl > 0 and v_gst > 0 then round((v_gst / v_excl) * 100, 2) else coalesce(v_gst_pct, 18) end,
        'gst_amount', v_gst,
        'round_off', v_round_off,
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

-- create_typed_draft: the version that was live (migration 0080 / apply_0079) with only the
-- hard-coded ₹1,000 petty cash check replaced by the category limit.
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
  v_is_payable boolean;
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head','admin') then
    raise exception 'Your role cannot raise requests';
  end if;

  if p_type::text in ('agreement', 'statutory_payment', 'audit_report') then
    if not (me.role = 'admin' or p_type = any(me.allowed_types)) then
      raise exception 'You do not have access to raise % requests yet', p_type;
    end if;
  elsif not (
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
  -- Category-aware Petty Cash limit (Normal 1000 · Accommodation 1500 · Water Bottle 2500 · Showroom 4000)
  if p_type::text = 'petty_cash' and v_amount > coalesce((v->'details'->>'max_limit')::numeric,
       case coalesce(v->'details'->>'petty_cash_category', 'normal')
         when 'showroom_cleaning' then 4000 when 'accommodation_cleaning' then 1500
         when 'water_bottle' then 2500 else 1000 end) then
    raise exception 'Petty Cash amount cannot exceed ₹% for %',
      coalesce((v->'details'->>'max_limit')::numeric, 1000), coalesce(v->'details'->>'petty_cash_category', 'normal');
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
  elsif me.role = 'head' then
    v_dept_id := me.department_id;
    v_owner_head_id := me.id;
    v_owner_head_name := me.full_name;
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
  elsif me.department_id is not null then
    select * into v_target_head from public.profiles
    where department_id = me.department_id and role = 'head' and is_active limit 1;
    v_dept_id := me.department_id;
    if v_target_head.id is not null then
      v_owner_head_id := v_target_head.id;
      v_owner_head_name := v_target_head.full_name;
    end if;
  else
    v_dept_id := me.department_id;
  end if;

  -- Shop assignment
  if p_type in ('general', 'non_cash') or p_type::text in ('petty_cash', 'agreement', 'statutory_payment', 'audit_report') then
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

  v_is_payable := p_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report');

  if v_is_payable then
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
  else
    v_disb_mode := null;
    v_bank_details := '{}'::jsonb;
  end if;

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
    case when v_is_payable then coalesce((coalesce(p_details, '{}'::jsonb)->>'enter_bank_details_later')::boolean, false) else false end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_no', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_ifsc', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_name', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_branch', '') else null end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_account_holder_name', '') else null end,
    case when v_is_payable then coalesce((coalesce(p_details, '{}'::jsonb)->>'bank_verified')::boolean, false) else false end,
    case when v_is_payable then nullif(coalesce(p_details, '{}'::jsonb)->>'bank_verification_message', '') else null end
  )
  returning id into v_id;

  return v_id;
end $function$;

revoke execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) from public, anon;
grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;

-- Helper used by the app / checks: limit for a petty cash category.
create or replace function public.petty_cash_limit(p_category text)
returns numeric language sql immutable set search_path = '' as $$
  select case coalesce(p_category, 'normal')
    when 'showroom_cleaning' then 4000
    when 'accommodation_cleaning' then 1500
    when 'water_bottle' then 2500
    else 1000 end::numeric
$$;
grant execute on function public.petty_cash_limit(text) to authenticated, anon, service_role;

-- ── Self-check ──────────────────────────────────────────────────────────────
with checks as (
  select '_build_details accepts Showroom Cleaning ₹4,000' as check_name,
         ((public._build_details('petty_cash'::public.request_type, 4000,
            '{"petty_cash_category":"showroom_cleaning","description":"test"}'::jsonb)
           -> 'details' ->> 'max_limit')::numeric = 4000) as ok,
         'this file' as fix_if_false
  union all
  select '_build_details keeps the category',
         (public._build_details('petty_cash'::public.request_type, 1200,
            '{"petty_cash_category":"accommodation_cleaning","description":"test"}'::jsonb)
           -> 'details' ->> 'petty_cash_category') = 'accommodation_cleaning',
         'this file'
  union all
  select 'create_typed_draft uses category limit',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'create_typed_draft'
                   and (pg_get_functiondef(p.oid) ilike '%showroom_cleaning%'
                        or pg_get_functiondef(p.oid) ilike '%max_limit%')),
         'this file'
  union all
  select 'requests table has every column create_typed_draft writes',
         not exists (
           select 1 from unnest(array[
             'requester_id','requester_name','requester_role','department_id','title','notes','amount',
             'request_type','shop_id','shop_name','details','owner_head_id','owner_head_name',
             'region_id','region_name','is_waitlist','disbursement_mode','enter_bank_details_later',
             'bank_account_no','bank_ifsc','bank_name','bank_branch','bank_account_holder_name',
             'bank_verified','bank_verification_message']) as c(col)
           where not exists (select 1 from information_schema.columns ic
                             where ic.table_schema = 'public' and ic.table_name = 'requests' and ic.column_name = c.col)),
         'send screenshot'
  union all
  select 'create_typed_draft has no is_draft column bug',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'create_typed_draft'
                       and pg_get_functiondef(p.oid) ilike '%is_draft%'),
         'this file'
  union all
  select 'submit_request uses category limit',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'submit_request'
                   and (pg_get_functiondef(p.oid) ilike '%showroom_cleaning%'
                        or pg_get_functiondef(p.oid) ilike '%max_limit%'))
           and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'submit_request'
                   and pg_get_functiondef(p.oid) ilike '%r.amount > 1000 then%'),
         'apply_0096_migrate_stuck_clerk_requests_to_head.sql'
)
select * from checks;
