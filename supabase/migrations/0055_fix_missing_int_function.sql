-- ============================================================================
-- 0055_fix_missing_int_function.sql
--
-- Fixes:
-- "function public._int(jsonb, unknown) does not exist"
--
-- Root Cause:
-- In migration 0051 (part 2), public._build_details was updated for exhibition
-- requests to parse voucher quantities using public._int(d, 'voucher_1000_qty')
-- and public._int(d, 'voucher_500_qty').
-- However, public._int helper function was never defined, so any save/edit/update
-- on an exhibition request (such as editing documents on a returned exhibition request)
-- fails with "function public._int(jsonb, unknown) does not exist".
-- ============================================================================

-- 1. Define public._int helper function
create or replace function public._int(p jsonb, k text)
returns int language plpgsql immutable set search_path = '' as $$
begin
  if p is not null and p ? k and nullif(btrim(p->>k), '') is not null then
    return greatest(0, round((p->>k)::numeric)::int);
  end if;
  return null;
exception when others then
  raise exception '% must be an integer', k;
end $$;

-- 2. Grant permissions on helper functions
grant execute on function public._int(jsonb, text) to authenticated, anon, service_role;
grant execute on function public._num(jsonb, text) to authenticated, anon, service_role;
grant execute on function public._txt(jsonb, text, int) to authenticated, anon, service_role;

-- 3. Ensure _build_details is valid and handles exhibition voucher quantities robustly
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
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_strip_nulls(jsonb_build_object(
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

notify pgrst, 'reload schema';
