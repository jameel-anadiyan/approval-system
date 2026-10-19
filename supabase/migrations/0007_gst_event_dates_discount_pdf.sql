-- 0007 — Exhibition: GST follows "GST Invoice Provided" (Yes = 18 %, No = 0 %),
--        event start / end date-time stored alongside the formatted event_dates.
--        Discount: a PDF attachment is mandatory to submit.

create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_inv boolean; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_q1000 int; v_q500 int; v_other numeric; v_budget numeric; v_provides jsonb;
  v_start text; v_end text;
begin
  if p_type = 'general' then
    if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
    return jsonb_build_object('amount', round(p_amount, 2), 'details', '{}'::jsonb);

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
    v_start := public._txt(d, 'event_start', 20);
    v_end := public._txt(d, 'event_end', 20);
    if v_start is not null and v_start !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then raise exception 'Invalid event start'; end if;
    if v_end is not null and v_end !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then raise exception 'Invalid event end'; end if;
    if v_start is not null and v_end is not null and v_end < v_start then raise exception 'Event end must be after the start'; end if;
    if public._txt(d, 'event_dates') is null then raise exception 'Event date(s) & time are required'; end if;
    v_excl := public._num(d, 'amount_excl_gst');
    if v_excl is null or v_excl <= 0 then raise exception 'Sponsorship amount (excl. GST) must be more than zero'; end if;
    v_gst_inv := coalesce((d->>'gst_invoice')::boolean, false);
    v_gst_pct := case when v_gst_inv then 18 else 0 end;
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
        'event_start', v_start,
        'event_end', v_end,
        'expected_footfall', public._txt(d, 'expected_footfall', 100),
        'stall_size_location', public._txt(d, 'stall_size_location'),
        'amount_excl_gst', v_excl, 'gst_pct', v_gst_pct, 'gst_amount', v_gst, 'total_incl_gst', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due'),
        'organiser_gstin', upper(coalesce(public._txt(d, 'organiser_gstin', 20), '')),
        'gst_invoice', v_gst_inv,
        'provides', v_provides,
        'provides_other', public._txt(d, 'provides_other', 200),
        'voucher_1000_qty', v_q1000, 'voucher_500_qty', v_q500,
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'voucher_validity', public._txt(d, 'voucher_validity', 100),
        'lucky_draw', public._txt(d, 'lucky_draw'),
        'winners_draw', public._txt(d, 'winners_draw'),
        'other_costs', v_other,
        'total_budget', v_budget,
        'purpose', public._txt(d, 'purpose', 2000)));
  end if;
end $$;

-- submit: General needs a document; Discount needs a PDF
create or replace function public.submit_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.requests; v_no text;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request has already been submitted'; end if;
  if r.amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if not (r.request_type = any(me.allowed_types)) then
    raise exception 'You are no longer allowed to raise % requests', r.request_type;
  end if;
  if r.request_type = 'general' and not exists (
       select 1 from public.request_files where request_id = r.id and kind = 'document') then
    raise exception 'Attach at least one document';
  end if;
  if r.request_type = 'discount' and not exists (
       select 1 from public.request_files
        where request_id = r.id and kind = 'document' and mime_type = 'application/pdf' and added_by is null) then
    raise exception 'Attach the discount PDF to submit';
  end if;
  v_no := coalesce(r.request_no, public.next_number(
    coalesce((select value #>> '{}' from public.app_settings where key = 'request_prefix'), 'REQ')));
  update public.requests set status = 'submitted', request_no = v_no,
    route = null, routed_by = null, routed_at = null, reviewed_by = null, reviewed_by_name = null, reviewed_at = null,
    submitted_at = coalesce(submitted_at, now()), updated_at = now()
  where id = r.id;
  perform public._log_action(r.id, me, case when r.status = 'returned' then 'resubmitted' else 'submitted' end,
    r.status, 'submitted', null, true);
  perform public.notify_next_actor(r.id, 'submitted');
end $$;
