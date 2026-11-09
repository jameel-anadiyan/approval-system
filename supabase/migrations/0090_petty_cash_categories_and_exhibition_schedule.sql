-- Migration 0090: Petty Cash Categories & Limits + Exhibition Daily Schedule Preservation
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Petty Cash Categories:
--    - Normal: ₹1,000 limit
--    - Showroom Cleaning: ₹4,000 limit
--    - Accommodation Cleaning: ₹1,500 limit
--    - Water Bottle: ₹2,500 limit, max ₹6.00 / bottle (enforced)
-- 2. Exhibition Schedules:
--    - Fix _build_details to preserve daily_schedules, total_days, and total_hours.
--    - Ensure calendar days are accurately calculated and stored.

-- 1. Update _build_details
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
    return jsonb_build_object(
      'amount', round(p_amount, 2),
      'details', jsonb_strip_nulls(jsonb_build_object(
        'base_amount', v_base,
        'has_gst', v_has_gst,
        'gst_rate', case when v_has_gst then coalesce(v_gen_rate, 18) else 0 end,
        'gst_amount', case when v_has_gst then v_gen_gst else 0 end,
        'total_amount', round(p_amount, 2))));

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
      -- itemized mode
      v_items := coalesce(d->'items', '[]'::jsonb);
      if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
        raise exception 'At least one line item is required for itemized Stock Transfer';
      end if;

      for v_item in select * from jsonb_array_elements(v_items) loop
        v_pieces := v_pieces + coalesce(public._int(v_item, 'pieces'), 0);
        v_gross_wt := v_gross_wt + coalesce(public._num(v_item, 'gross_weight'), 0);
        v_mrp_total := v_mrp_total + coalesce(public._num(v_item, 'total_mrp'), 0);
      end loop;

      if v_pieces <= 0 then raise exception 'Total pieces must be at least 1'; end if;
      if v_gross_wt <= 0 then raise exception 'Total gross weight must be greater than zero'; end if;
      if v_mrp_total <= 0 then raise exception 'Total MRP must be greater than zero'; end if;

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
        'daily_schedules', d->'daily_schedules',
        'total_days', coalesce(public._int(d, 'total_days'), jsonb_array_length(coalesce(d->'daily_schedules', '[]'::jsonb))),
        'total_hours', public._num(d, 'total_hours'),
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

-- 2. Update create_typed_draft to enforce dynamic petty cash category limits
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
  v_pc_limit numeric;
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

  if p_type::text = 'petty_cash' then
    v_pc_limit := coalesce((v->'details'->>'max_limit')::numeric, 1000);
    if v_amount > v_pc_limit then
      raise exception 'Petty Cash amount cannot exceed ₹% for %', v_pc_limit, coalesce(v->'details'->>'petty_cash_category', 'normal');
    end if;
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

  -- Region snapshot for Exhibition
  if p_type = 'exhibition' then
    if (v_clean_details ? 'region_id') and (v_clean_details->>'region_id') ~ '^[0-9a-fA-F-]{36}$' then
      v_region_id := (v_clean_details->>'region_id')::uuid;
      v_region_name := v_clean_details->>'region_name';
    elsif me.region_id is not null then
      v_region_id := me.region_id;
      select name into v_region_name from public.regions where id = me.region_id;
    end if;
    v_is_waitlist := coalesce((v->'details'->>'is_waitlist')::boolean, false);
  end if;

  v_is_payable := p_type::text not in ('discount', 'non_cash', 'stock_transfer', 'agreement', 'audit_report');

  if v_is_payable then
    v_disb_mode := nullif(p_details->>'disbursement_mode', '');
    if p_type::text = 'petty_cash' and v_disb_mode is null then
      v_disb_mode := 'cash';
    end if;

    v_bank_details := jsonb_strip_nulls(jsonb_build_object(
      'disbursement_mode', v_disb_mode,
      'enter_bank_details_later', coalesce((p_details->>'enter_bank_details_later')::boolean, false),
      'bank_account_no', nullif(p_details->>'bank_account_no', ''),
      'bank_ifsc', nullif(p_details->>'bank_ifsc', ''),
      'bank_name', nullif(p_details->>'bank_name', ''),
      'bank_branch', nullif(p_details->>'bank_branch', ''),
      'bank_account_holder_name', nullif(p_details->>'bank_account_holder_name', ''),
      'bank_verified', coalesce((p_details->>'bank_verified')::boolean, false),
      'bank_verification_message', nullif(p_details->>'bank_verification_message', '')
    ));

    v := jsonb_set(v, '{details}', coalesce(v->'details', '{}'::jsonb) || v_bank_details);
  end if;

  insert into public.requests (
    request_type, requester_id, department_id, title, notes,
    amount, details, status, is_draft, owner_head_id, owner_head_name,
    shop_id, shop_name, region_id, region_name, is_waitlist,
    disbursement_mode, enter_bank_details_later, bank_account_no, bank_ifsc,
    bank_name, bank_branch, bank_account_holder_name, bank_verified, bank_verification_message,
    assigned_entry_user_id
  ) values (
    p_type, me.id, v_dept_id, v_title, nullif(btrim(coalesce(p_notes, '')), ''),
    v_amount, v->'details', 'draft', true, v_owner_head_id, v_owner_head_name,
    v_shop_id, v_shop, v_region_id, v_region_name, coalesce(v_is_waitlist, false),
    v_disb_mode::public.disbursement_mode,
    case when v_disb_mode = 'bank' then coalesce((p_details->>'enter_bank_details_later')::boolean, false) else false end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_account_no', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_ifsc', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_name', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_branch', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_account_holder_name', '') else null end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then coalesce((p_details->>'bank_verified')::boolean, false) else false end,
    case when v_disb_mode = 'bank' and not coalesce((p_details->>'enter_bank_details_later')::boolean, false) then nullif(p_details->>'bank_verification_message', '') else null end,
    case when (p_details ? 'assigned_entry_user_id') and (p_details->>'assigned_entry_user_id') ~ '^[0-9a-fA-F-]{36}$'
         then (p_details->>'assigned_entry_user_id')::uuid else null end
  ) returning id into v_id;

  return v_id;
end $function$;

grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;

-- 3. Update submit_request to validate petty cash categories & bottle price
create or replace function public.submit_request(p_request_id uuid, p_entry_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  rh public.profiles;
  pc_head public.profiles;
  target_entry_user public.profiles;
  v_next public.request_status;
  v_rh_count int;
  v_no text;
  v_clerk public.profiles;
  v_head_clerk public.profiles;
  v_is_cross_head boolean := false;
  v_pc_limit numeric;
  v_pc_cat text;
  v_bottle_qty int;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found'; end if;

  if r.status not in ('draft', 'returned') then
    raise exception 'Only draft or returned requests can be submitted';
  end if;

  if r.requester_id <> me.id and me.role <> 'admin' then
    if not (r.status = 'returned' and me.role = 'clerk' and r.department_id = me.department_id) then
      raise exception 'Only the requester can submit this request';
    end if;
  end if;

  -- Optional entry account assignment on submission
  if p_entry_user_id is not null then
    select * into target_entry_user from public.profiles
    where id = p_entry_user_id and is_active = true and role = 'disbursement' and disbursement_type = 'entry_only';

    if target_entry_user.id is null then
      raise exception 'Selected Disbursement Entry Account is invalid, inactive, or not Entry Only';
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
    v_pc_limit := coalesce((r.details->>'max_limit')::numeric, 1000);
    v_pc_cat := coalesce(r.details->>'petty_cash_category', 'normal');
    v_bottle_qty := (r.details->>'bottle_qty')::int;

    if r.amount > v_pc_limit then
      raise exception 'Petty Cash amount cannot exceed ₹% for %', v_pc_limit, v_pc_cat;
    end if;
    if v_pc_cat = 'water_bottle' and v_bottle_qty is not null and v_bottle_qty > 0 then
      if round(r.amount / v_bottle_qty, 2) > 6.00 then
        raise exception 'Bottle price is high please put this in general request';
      end if;
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

    if r.request_no is null then
      v_no := public.gen_request_no();
    else
      v_no := r.request_no;
    end if;

    if me.role = 'employee' and rh.id is not null then
      update public.requests set
        status = 'pending_regional_forward',
        request_no = v_no,
        category_id = null,
        category_name = null,
        disbursement_mode = coalesce(r.disbursement_mode, 'cash'),
        regional_head_id = rh.id,
        regional_head_name = rh.full_name,
        route = 'B'::public.approval_route,
        routed_by = coalesce(r.routed_by, me.id),
        routed_at = coalesce(r.routed_at, now()),
        reviewed_by = null,
        reviewed_by_name = null,
        reviewed_at = null,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, 'pending_regional_forward',
        'Petty Cash routed to Regional Head ' || rh.full_name || ' (clerk skipped)', true);
      perform public.notify_next_actor(r.id, 'pending_regional_forward');
      return;

    elsif pc_head.id is not null then
      update public.requests set
        status = 'pending_head_approval',
        request_no = v_no,
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
  if r.request_type::text not in ('exhibition', 'petty_cash') and me.role not in ('head', 'admin') and r.category_id is null then
    if exists (select 1 from public.request_categories rc where rc.is_active and (rc.department_id is null or rc.department_id = r.department_id)) then
      raise exception 'Please select a work category before submitting';
    end if;
  end if;

  if r.request_type = 'asset_below_20k' and r.amount > 20000 then
    raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
  end if;

  if r.request_no is null then
    v_no := public.gen_request_no();
  else
    v_no := r.request_no;
  end if;

  -- Role-specific routing
  if me.role = 'head' then
    v_is_cross_head := r.owner_head_id is not null and r.owner_head_id <> me.id;

    if v_is_cross_head then
      select * into pc_head from public.profiles where id = r.owner_head_id and role = 'head' and is_active;
      if pc_head.id is null then
        raise exception 'Assigned Department Head is not active or not found';
      end if;

      if r.category_id is null then
        if exists (select 1 from public.request_categories rc where rc.is_active and (rc.department_id is null or rc.department_id = pc_head.department_id)) then
          raise exception 'Please select a work category under % before routing', pc_head.full_name;
        end if;
      end if;

      select * into v_head_clerk
      from public.profiles
      where role = 'clerk' and department_id = pc_head.department_id and is_active
      order by created_at asc limit 1;

      if v_head_clerk.id is not null then
        v_next := 'pending_clerk_review';
        update public.requests set
          status = v_next,
          request_no = v_no,
          department_id = pc_head.department_id,
          route = 'B'::public.approval_route,
          routed_by = me.id,
          routed_at = now(),
          reviewed_by = null,
          reviewed_by_name = null,
          reviewed_at = null,
          submitted_at = coalesce(submitted_at, now()),
          updated_at = now()
        where id = r.id;

        perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
          r.status, v_next,
          'Department Head routed request to ' || pc_head.full_name || ' Department Clerk (' || v_head_clerk.full_name || ')',
          true);
        perform public.notify_next_actor(r.id, v_next);
        return;
      else
        v_next := 'pending_head_approval';
        update public.requests set
          status = v_next,
          request_no = v_no,
          department_id = pc_head.department_id,
          route = 'B'::public.approval_route,
          routed_by = me.id,
          routed_at = now(),
          reviewed_by = null,
          reviewed_by_name = null,
          reviewed_at = null,
          submitted_at = coalesce(submitted_at, now()),
          updated_at = now()
        where id = r.id;

        perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
          r.status, v_next,
          'Department Head routed request directly to ' || pc_head.full_name || ' (no clerk configured)',
          true);
        perform public.notify_next_actor(r.id, v_next);
        return;
      end if;

    else
      -- Direct to Admin
      v_next := 'pending_admin_approval';
      update public.requests set
        status = v_next,
        request_no = v_no,
        route = 'A'::public.approval_route,
        routed_by = me.id,
        routed_at = now(),
        reviewed_by = me.id,
        reviewed_by_name = me.full_name,
        reviewed_at = now(),
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;

      perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
        r.status, v_next,
        'Department Head routed directly to Admin for approval',
        true);
      perform public.notify_next_actor(r.id, v_next);
      return;
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

    if rh.id is not null then
      v_next := 'pending_regional_forward';
      update public.requests set
        status = v_next,
        request_no = v_no,
        regional_head_id = rh.id,
        regional_head_name = rh.full_name,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;
    else
      v_next := 'pending_clerk_review';
      update public.requests set
        status = v_next,
        request_no = v_no,
        submitted_at = coalesce(submitted_at, now()),
        updated_at = now()
      where id = r.id;
    end if;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when rh.id is not null then 'Submitted to Regional Head ' || rh.full_name else 'Submitted to Clerk' end,
      true);
    perform public.notify_next_actor(r.id, v_next);

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
      route = case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end,
      routed_by = coalesce(r.routed_by, me.id),
      routed_at = coalesce(r.routed_at, now()),
      reviewed_by = me.id,
      reviewed_by_name = me.full_name,
      reviewed_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
      r.status, v_next,
      case when r.status = 'returned' then 'Clerk resubmitted request' else 'Clerk submitted request' end,
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
      route = case when v_next = 'pending_head_review' then 'A'::public.approval_route else 'B'::public.approval_route end,
      routed_by = coalesce(r.routed_by, me.id),
      routed_at = coalesce(r.routed_at, now()),
      regional_forwarded_at = now(),
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'resubmitted',
      r.status, v_next,
      'Regional Head resubmitted returned request',
      true);
    perform public.notify_next_actor(r.id, v_next);
  end if;
end $function$;

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;

-- 4. Backfill existing exhibition requests to ensure total_days is stored as calendar days
update public.requests
set details = jsonb_set(
  details,
  '{total_days}',
  to_jsonb(
    greatest(
      1,
      coalesce(
        jsonb_array_length(details->'daily_schedules'),
        case
          when (details->>'event_end') is not null and (details->>'event_start') is not null
          then ((details->>'event_end')::date - (details->>'event_start')::date + 1)
          else 1
        end
      )
    )
  )
)
where request_type = 'exhibition'
  and (details->>'total_days' is null or (details->>'total_days')::int <= 0);

notify pgrst, 'reload schema';
