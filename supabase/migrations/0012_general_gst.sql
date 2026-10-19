-- Migration 0012: Support GST breakdown details in general requests

create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_q1000 int; v_q500 int; v_other numeric; v_budget numeric; v_provides jsonb;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
begin
  if p_type = 'general' then
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
      'details', jsonb_build_object(
        'before_amount', v_before, 'after_amount', v_after,
        'discount_amount', v_before - v_after,
        'discount_pct', round((v_before - v_after) / v_before * 100, 2),
        'customer_name', public._txt(d, 'customer_name', 100),
        'reference', public._txt(d, 'reference', 100)));

  else -- exhibition
    if public._txt(d, 'event_name') is null then raise exception 'Event name is required'; end if;
    if public._txt(d, 'venue') is null then raise exception 'Venue is required'; end if;
    if public._txt(d, 'event_dates') is null then raise exception 'Event date(s) & time are required'; end if;
    v_excl := public._num(d, 'amount_excl_gst');
    if v_excl is null or v_excl <= 0 then raise exception 'Sponsorship amount (excl. GST) must be more than zero'; end if;
    v_gst_pct := coalesce(public._num(d, 'gst_pct'), 0);
    if v_gst_pct < 0 or v_gst_pct > 100 then raise exception 'GST %% must be between 0 and 100'; end if;
    v_gst := round(v_excl * v_gst_pct / 100, 2);
    v_total := v_excl + v_gst;
    v_q1000 := greatest(coalesce(public._num(d, 'voucher_1000_qty'), 0), 0)::int;
    v_q500 := greatest(coalesce(public._num(d, 'voucher_500_qty'), 0), 0)::int;
    v_other := greatest(coalesce(public._num(d, 'other_costs'), 0), 0);
    v_budget := coalesce(public._num(d, 'total_budget'), v_total + v_q1000 * 1000 + v_q500 * 500 + v_other);
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_provides
      from jsonb_array_elements_text(case when jsonb_typeof(d->'provides') = 'array' then d->'provides' else '[]'::jsonb end) x
      where x in ('stall_space','table_chairs','electricity_lights','logo_stage_banners','stage_announcements','social_media','other');
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_build_object(
        'event_name', public._txt(d, 'event_name', 200),
        'organiser_contact', public._txt(d, 'organiser_contact'),
        'venue', public._txt(d, 'venue'),
        'event_dates', public._txt(d, 'event_dates'),
        'expected_footfall', public._txt(d, 'expected_footfall', 100),
        'stall_size_location', public._txt(d, 'stall_size_location'),
        'amount_excl_gst', v_excl, 'gst_pct', v_gst_pct, 'gst_amount', v_gst, 'total_incl_gst', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due'),
        'organiser_gstin', upper(coalesce(public._txt(d, 'organiser_gstin', 20), '')),
        'gst_invoice', coalesce((d->>'gst_invoice')::boolean, false),
        'provides', v_provides,
        'provides_other', public._txt(d, 'provides_other', 200),
        'voucher_1000_qty', v_q1000, 'voucher_500_qty', v_q500,
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'other_costs', v_other, 'total_budget', v_budget,
        'terms', public._txt(d, 'terms')));
  end if;
end $$;
