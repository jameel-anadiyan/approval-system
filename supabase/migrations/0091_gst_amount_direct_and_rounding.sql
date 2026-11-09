-- Migration 0091: Direct GST Amount Typing & Nearest ₹1 Standard Rounding
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. If GST is applicable, the GST amount is entered directly in rupees (not just %).
-- 2. Final total amount (incl. GST) is rounded to the nearest ₹1 (standard rounding rule: >= .50 up, < .50 down).
-- 3. Round-off adjustment is tracked and preserved in details for transparent invoicing.

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
