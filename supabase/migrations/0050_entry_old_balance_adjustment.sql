-- ============================================================================
-- 0050_entry_old_balance_adjustment.sql
--
-- Entry-Only accounts can enter an "Old balance / Old advance adjustment" on a
-- disbursement entry, and payments can ONLY be released against entries.
--
--   Example: request ₹10,000, old advance ₹3,000
--     - Entry #1: entry amount ₹5,000 + adjustment ₹3,000
--         -> ₹3,000 is settled immediately (payment_mode 'Adjustment',
--            request_payments.is_adjustment = true)
--         -> Payment-Only can pay at most ₹5,000 (the entry amount)
--     - Entry #2: entry amount ₹2,000 -> Payment-Only can pay at most ₹2,000
--     - Without an entry, no payment can be released (for anyone, incl. Admin).
--
--   Rules
--     - Entry amount = amount the Payment-Only account pays (can be 0 when the
--       entry only records an adjustment). Adjustment is separate.
--     - New entry (amount + adjustment) <= request amount - already paid/adjusted
--       - amount of pending (unpaid) entries.
--     - An entry with amount 0 (adjustment only) is marked paid straight away;
--       if that clears the balance the request becomes 'paid'.
--     - Removing a pending entry reverses its adjustment.
--     - add_payment / mark_paid (payment without an entry) are disabled.
--
-- Safe to re-run.
-- ============================================================================

-- 1. Columns / checks ---------------------------------------------------------

alter table public.disbursement_entries
  add column if not exists adjustment_amount numeric(14,2) not null default 0,
  add column if not exists adjustment_payment_id uuid references public.request_payments(id) on delete set null;

-- entry amount may now be 0 when the entry only carries an adjustment
alter table public.disbursement_entries drop constraint if exists disbursement_entries_amount_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_adjustment_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_amounts_check;
alter table public.disbursement_entries
  add constraint disbursement_entries_amounts_check
  check (amount >= 0 and adjustment_amount >= 0 and amount + adjustment_amount > 0);

alter table public.request_payments
  add column if not exists is_adjustment boolean not null default false;

-- 2. add_disbursement_entry (with p_adjustment) --------------------------------

drop function if exists public.add_disbursement_entry(uuid, numeric, boolean, text);

create or replace function public.add_disbursement_entry(
  p_request_id uuid,
  p_amount numeric,
  p_tds_cut boolean default false,
  p_notes text default null,
  p_adjustment numeric default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_next_no int;
  v_amt numeric;
  v_adj numeric;
  v_entry_id uuid;
  v_pending_sum numeric;
  v_available numeric;
  v_payment_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_paid numeric;
  v_full boolean := false;
  v_adjust_only boolean;
  v_notes text := nullif(btrim(p_notes), '');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'entry_only') then
    raise exception 'Permission denied: Only Entry-Only or Admin disbursement accounts can create entries';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type in ('discount', 'non_cash', 'stock_transfer') then raise exception 'Not found'; end if;
  if r.status <> 'approved' then raise exception 'Entries can only be created for approved requests waiting for payment'; end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);
  if v_amt < 0 then raise exception 'Entry amount cannot be negative'; end if;
  if v_adj < 0 then raise exception 'Old balance / advance adjustment cannot be negative'; end if;
  if v_amt + v_adj <= 0 then raise exception 'Enter an entry amount or an old balance / advance adjustment'; end if;
  v_adjust_only := v_amt = 0;

  select coalesce(sum(amount), 0) into v_pending_sum
    from public.disbursement_entries
   where request_id = r.id and status = 'pending';

  v_available := round(r.amount - coalesce(r.paid_amount, 0) - v_pending_sum, 2);
  if v_amt + v_adj > v_available then
    raise exception 'Entry ₹% + adjustment ₹% is more than the balance available for entries (₹%)',
      v_amt, v_adj, greatest(v_available, 0);
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_next_no
    from public.disbursement_entries
   where request_id = r.id;

  insert into public.disbursement_entries (
    request_id, entry_no, amount, adjustment_amount, tds_cut, status, notes, created_by, created_by_name
  ) values (
    r.id, v_next_no, v_amt, v_adj, coalesce(p_tds_cut, false),
    case when v_adjust_only then 'paid' else 'pending' end,
    v_notes, me.id, me.full_name
  ) returning id into v_entry_id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_created', r.status, r.status,
    'Entry #' || v_next_no || ' added: ₹' || to_char(v_amt, 'FM999999999990.00') || ' to pay'
      || case when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
      || case when v_adj > 0
              then ' · Old balance / advance adjusted ₹' || to_char(v_adj, 'FM999999999990.00')
              else '' end
      || coalesce(' · ' || v_notes, ''),
    true
  );

  -- Settle the adjustment immediately
  if v_adj > 0 then
    insert into public.request_payments (
      request_id, amount, payment_date, payment_mode, payment_ref, remarks, paid_by, paid_by_name, entry_id, is_adjustment
    ) values (
      r.id, v_adj, v_today, 'Adjustment', null,
      left('Old balance / old advance adjustment · Entry #' || v_next_no || coalesce(' · ' || v_notes, ''), 500),
      me.id, me.full_name, v_entry_id, true
    ) returning id into v_payment_id;

    update public.disbursement_entries set
      adjustment_payment_id = v_payment_id,
      paid_at = case when v_adjust_only then now() else paid_at end,
      paid_by = case when v_adjust_only then me.id else paid_by end,
      paid_by_name = case when v_adjust_only then me.full_name else paid_by_name end,
      payment_id = case when v_adjust_only then v_payment_id else payment_id end
    where id = v_entry_id;

    v_paid := coalesce(r.paid_amount, 0) + v_adj;
    v_full := v_paid >= r.amount;

    if v_full then
      update public.requests set
        status = 'paid',
        paid_amount = v_paid,
        paid_by = me.id,
        paid_at = now(),
        payment_date = v_today,
        payment_mode = 'Adjustment',
        payment_ref = null,
        payment_remarks = 'Old balance / old advance adjustment',
        updated_at = now()
      where id = r.id;

      perform public._log_action(
        r.id, me, 'paid', 'approved', 'paid',
        'Entry #' || v_next_no || ' · ₹' || to_char(v_adj, 'FM999999999990.00')
          || ' settled by old balance / advance adjustment · Paid in full',
        true
      );
      perform public.notify_next_actor(r.id, 'paid');
    else
      update public.requests set paid_amount = v_paid, updated_at = now() where id = r.id;

      perform public._log_action(
        r.id, me, 'partial_payment', 'approved', 'approved',
        'Entry #' || v_next_no || ' · ₹' || to_char(v_adj, 'FM999999999990.00')
          || ' settled by old balance / advance adjustment · Balance remaining ₹'
          || to_char(r.amount - v_paid, 'FM999999999990.00'),
        true
      );
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'entry_no', v_next_no,
    'amount', v_amt,
    'adjustment_amount', v_adj,
    'payable_amount', v_amt,
    'tds_cut', coalesce(p_tds_cut, false),
    'fully_paid', v_full
  );
end $$;
revoke execute on function public.add_disbursement_entry(uuid, numeric, boolean, text, numeric) from public, anon;
grant execute on function public.add_disbursement_entry(uuid, numeric, boolean, text, numeric) to authenticated;

-- 3. cancel_disbursement_entry (reverses the adjustment) ----------------------

create or replace function public.cancel_disbursement_entry(
  p_entry_id uuid,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'entry_only') then
    raise exception 'Permission denied: Only Entry-Only or Admin disbursement accounts can cancel entries';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status = 'paid' then raise exception 'Cannot cancel an entry that has already been paid'; end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.status <> 'approved' then raise exception 'Entries can only be removed while the request is waiting for payment'; end if;

  if coalesce(e.adjustment_amount, 0) > 0 then
    delete from public.request_payments
     where id = e.adjustment_payment_id
        or (entry_id = e.id and is_adjustment);
    update public.requests
       set paid_amount = greatest(0, coalesce(paid_amount, 0) - e.adjustment_amount),
           updated_at = now()
     where id = r.id;
  end if;

  delete from public.disbursement_entries where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_cancelled', r.status, r.status,
    'Entry #' || e.entry_no || ' (₹' || to_char(e.amount, 'FM999999999990.00') || ') removed'
      || case when coalesce(e.adjustment_amount, 0) > 0
              then ' · adjustment of ₹' || to_char(e.adjustment_amount, 'FM999999999990.00') || ' reversed'
              else '' end
      || coalesce(' · ' || nullif(btrim(p_reason), ''), ''),
    true
  );

  return jsonb_build_object('success', true, 'deleted_id', p_entry_id);
end $$;
revoke execute on function public.cancel_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.cancel_disbursement_entry(uuid, text) to authenticated;

-- 4. pay_disbursement_entry (max = entry amount) -------------------------------

create or replace function public.pay_disbursement_entry(
  p_entry_id uuid,
  p_amount numeric default null,
  p_payment_date date default null,
  p_payment_mode text default null,
  p_payment_ref text default null,
  p_remarks text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_amt numeric;
  v_payable numeric;
  v_date date;
  v_payment_id uuid;
  v_paid numeric;
  v_full boolean;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'payment_only') then
    raise exception 'Permission denied: Only Payment-Only or Admin accounts can disburse payments';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending' then raise exception 'This entry has already been paid or cancelled'; end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.id is null or r.request_type = 'discount' then raise exception 'Request not found'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be paid'; end if;

  v_payable := round(least(e.amount, r.amount - coalesce(r.paid_amount, 0)), 2);
  if v_payable <= 0 then raise exception 'Nothing left to pay on Entry #%', e.entry_no; end if;
  v_amt := round(coalesce(p_amount, v_payable), 2);
  if v_amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  if v_amt > v_payable then
    raise exception 'Payment amount (₹%) cannot exceed the amount of Entry #% (₹%)', v_amt, e.entry_no, v_payable;
  end if;

  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date);
  if v_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Payment date cannot be in the future';
  end if;

  insert into public.request_payments (
    request_id, amount, payment_date, payment_mode, payment_ref, remarks, paid_by, paid_by_name, entry_id
  ) values (
    r.id, v_amt, v_date, nullif(btrim(p_payment_mode), ''), nullif(btrim(p_payment_ref), ''),
    nullif(btrim(p_remarks), ''), me.id, me.full_name, e.id
  ) returning id into v_payment_id;

  update public.disbursement_entries set
    status = 'paid',
    paid_at = now(),
    paid_by = me.id,
    paid_by_name = me.full_name,
    payment_id = v_payment_id
  where id = e.id;

  v_paid := coalesce(r.paid_amount, 0) + v_amt;
  v_full := v_paid >= r.amount;

  if v_full then
    update public.requests set
      status = 'paid',
      paid_amount = v_paid,
      paid_by = me.id,
      paid_at = now(),
      payment_date = v_date,
      payment_mode = nullif(btrim(p_payment_mode), ''),
      payment_ref = nullif(btrim(p_payment_ref), ''),
      payment_remarks = nullif(btrim(p_remarks), ''),
      updated_at = now()
    where id = r.id;

    perform public._log_action(
      r.id, me, 'paid', 'approved', 'paid',
      'Entry #' || e.entry_no || ' settled ₹' || to_char(v_amt, 'FM999999999990.00')
        || ' via ' || coalesce(p_payment_mode, 'Payment')
        || case when e.tds_cut then ' (TDS Cut)' else ' (TDS Not Cut)' end
        || ' · Final payment (Paid in full)',
      true
    );
    perform public.notify_next_actor(r.id, 'paid');
  else
    update public.requests set paid_amount = v_paid, updated_at = now() where id = r.id;

    perform public._log_action(
      r.id, me, 'partial_payment', 'approved', 'approved',
      'Entry #' || e.entry_no || ' settled ₹' || to_char(v_amt, 'FM999999999990.00')
        || ' via ' || coalesce(p_payment_mode, 'Payment')
        || case when e.tds_cut then ' (TDS Cut)' else ' (TDS Not Cut)' end
        || ' · Balance remaining ₹' || to_char(r.amount - v_paid, 'FM999999999990.00')
        || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''),
      true
    );
    perform public._notify(
      array[r.requester_id], r.id, 'Payment entry settled',
      coalesce(r.request_no, 'Request') || ' - Entry #' || e.entry_no || ' (₹' || to_char(v_amt, 'FM999999999990.00') || ') paid'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', v_amt,
    'fully_paid', v_full
  );
end $$;
revoke execute on function public.pay_disbursement_entry(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.pay_disbursement_entry(uuid, numeric, date, text, text, text) to authenticated;

-- 5. No payment without an entry (applies to everyone, incl. Admin) -----------
-- mark_paid() calls add_payment(), so it is blocked too.

create or replace function public.add_payment(
  p_request_id uuid, p_amount numeric, p_payment_date date default null, p_payment_mode text default null,
  p_payment_ref text default null, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Payments can only be released against a disbursement entry. Ask the Entry-Only account to create an entry first.';
end $$;
revoke execute on function public.add_payment(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.add_payment(uuid, numeric, date, text, text, text) to authenticated;

-- 6. Ensure _build_details handles 'non_cash' so it never falls through to exhibition
create or replace function public._build_details(p_type public.request_type, p_amount numeric, p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  d jsonb := coalesce(p, '{}'::jsonb);
  v_before numeric; v_after numeric; v_excl numeric; v_gst_pct numeric; v_gst numeric; v_total numeric;
  v_has_gst boolean; v_base numeric; v_gen_gst numeric; v_gen_rate numeric;
  -- Stock transfer variables
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
      'details', coalesce(d, '{}'::jsonb)
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

  elsif p_type = 'non_cash' then
    return jsonb_build_object(
      'amount', 0,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'associated_value', public._num(d, 'associated_value'),
        'associated_notes', public._txt(d, 'associated_notes', 500)
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
    v_from_shop := public._txt(d, 'from_shop_name', 150);
    v_to_shop := public._txt(d, 'to_shop_name', 150);
    if public._txt(d, 'from_shop_id') is null then raise exception 'Source (From) shop is required'; end if;
    if public._txt(d, 'to_shop_id') is null then raise exception 'Destination (To) shop is required'; end if;
    if (d->>'from_shop_id') = (d->>'to_shop_id') then
      raise exception 'Destination shop cannot be the same as source shop';
    end if;

    v_mode := coalesce(d->>'transfer_mode', 'itemized');
    if v_mode = 'bulk' then
      v_pieces := coalesce((d->>'pieces_count')::int, 0);
      v_gross_wt := coalesce(public._num(d, 'total_gross_weight'), 0);
      v_mrp_total := coalesce(public._num(d, 'total_mrp'), 0);
      if v_pieces <= 0 then raise exception 'Number of pieces must be at least 1'; end if;
      if v_gross_wt <= 0 then raise exception 'Total gross weight must be greater than zero'; end if;
      if v_mrp_total <= 0 then raise exception 'Total MRP must be greater than zero'; end if;

      return jsonb_build_object(
        'amount', round(v_mrp_total, 2),
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'bulk',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', v_from_shop,
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', v_to_shop,
          'category_id', d->>'category_id',
          'category_name', public._txt(d, 'category_name', 100),
          'pieces_count', v_pieces,
          'total_pieces', v_pieces,
          'total_gross_weight', round(v_gross_wt, 3),
          'total_mrp', round(v_mrp_total, 2),
          'notes', public._txt(d, 'notes', 2000)
        ))
      );
    else
      -- Itemized transfer
      v_items := coalesce(d->'items', '[]'::jsonb);
      if jsonb_array_length(v_items) = 0 then
        raise exception 'Add at least one product to transfer';
      end if;

      for v_item in select * from jsonb_array_elements(v_items)
      loop
        v_pieces := v_pieces + 1;
        v_gross_wt := v_gross_wt + coalesce((v_item->>'gross_weight')::numeric, 0);
        v_mrp_total := v_mrp_total + coalesce((v_item->>'mrp')::numeric, 0);
      end loop;

      return jsonb_build_object(
        'amount', round(v_mrp_total, 2),
        'details', jsonb_strip_nulls(jsonb_build_object(
          'transfer_mode', 'itemized',
          'from_shop_id', d->>'from_shop_id',
          'from_shop_name', v_from_shop,
          'to_shop_id', d->>'to_shop_id',
          'to_shop_name', v_to_shop,
          'items', v_items,
          'pieces_count', v_pieces,
          'total_pieces', v_pieces,
          'total_gross_weight', round(v_gross_wt, 3),
          'total_mrp', round(v_mrp_total, 2),
          'notes', public._txt(d, 'notes', 2000)
        ))
      );
    end if;

  else -- exhibition
    if public._txt(d, 'event_name') is null then raise exception 'Event name is required'; end if;
    if public._txt(d, 'venue') is null then raise exception 'Venue is required'; end if;
    if public._txt(d, 'event_dates') is null then raise exception 'Event date(s) & time are required'; end if;
    v_excl := public._num(d, 'amount_excl_gst');
    if v_excl is null or v_excl <= 0 then raise exception 'Sponsorship amount (excl. GST) must be more than zero'; end if;
    v_has_gst := coalesce((d->>'has_gst')::boolean, true);
    v_gst_pct := coalesce(public._num(d, 'gst_pct'), 18);
    v_gst := case when v_has_gst then round(v_excl * (v_gst_pct / 100), 2) else 0 end;
    v_total := v_excl + v_gst;
    return jsonb_build_object(
      'amount', v_total,
      'details', jsonb_strip_nulls(jsonb_build_object(
        'event_name', public._txt(d, 'event_name', 150),
        'venue', public._txt(d, 'venue', 200),
        'event_dates', public._txt(d, 'event_dates', 200),
        'event_start', public._txt(d, 'event_start', 30),
        'event_end', public._txt(d, 'event_end', 30),
        'amount_excl_gst', v_excl,
        'has_gst', v_has_gst,
        'gst_pct', v_gst_pct,
        'gst_amount', v_gst,
        'total_amount', v_total,
        'payment_mode_due', public._txt(d, 'payment_mode_due', 100),
        'organiser_contact', public._txt(d, 'organiser_contact', 150),
        'organiser_gstin', public._txt(d, 'organiser_gstin', 30),
        'gst_invoice', coalesce((d->>'gst_invoice')::boolean, false),
        'expected_footfall', public._txt(d, 'expected_footfall', 50),
        'stall_size_location', public._txt(d, 'stall_size_location', 100),
        'provides', d->'provides',
        'provides_other', public._txt(d, 'provides_other', 200),
        'voucher_1000_qty', public._num(d, 'voucher_1000_qty'),
        'voucher_500_qty', public._num(d, 'voucher_500_qty'),
        'voucher_1000_min', public._num(d, 'voucher_1000_min'),
        'voucher_500_min', public._num(d, 'voucher_500_min'),
        'voucher_validity', public._txt(d, 'voucher_validity', 50),
        'lucky_draw', public._txt(d, 'lucky_draw', 150),
        'winners_draw', public._txt(d, 'winners_draw', 100),
        'other_costs', public._num(d, 'other_costs'),
        'total_budget', coalesce(public._num(d, 'total_budget'), v_total),
        'purpose', public._txt(d, 'purpose', 1000),
        'is_waitlist', coalesce((d->>'is_waitlist')::boolean, false)
      ))
    );
  end if;
end $function$;
revoke execute on function public._build_details(public.request_type, numeric, jsonb) from public, anon;
grant execute on function public._build_details(public.request_type, numeric, jsonb) to authenticated;

-- 7. Fix requests amount check constraint to allow 0 for non_cash requests -----
alter table public.requests drop constraint if exists requests_amount_check;
alter table public.requests add constraint requests_amount_check check (amount >= 0);

-- 8. Ensure shop helper functions are executable by authenticated users --------
grant execute on function public._user_shop_ids(uuid) to authenticated;
grant execute on function public._resolve_request_shop(public.profiles, jsonb) to authenticated;

-- 9. Complete create_typed_draft (supports non_cash cleanly and records shop) --
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
begin
  me := public._me();
  if me.role not in ('employee','clerk','head','regional_head') then
    raise exception 'Your role cannot raise requests';
  end if;
  if not (p_type = any(me.allowed_types) or (p_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
    raise exception 'You are not allowed to raise % requests', p_type;
  end if;

  -- The shop choice travels inside p_details; never store it in the typed details.
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
  else
    v_shop_id := me.shop_id;
  end if;
  if v_shop_id is not null then
    select name into v_shop from public.shops where id = v_shop_id;
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

  insert into public.requests (
    requester_id, requester_name, requester_role, department_id, title, notes, amount,
    request_type, shop_id, shop_name, details, owner_head_id, owner_head_name,
    region_id, region_name, is_waitlist
  )
  values (
    me.id, me.full_name, me.role, v_dept_id, left(v_title, 200), nullif(btrim(p_notes), ''),
    v_amount, p_type, v_shop_id, v_shop, case when p_type = 'non_cash' then v_clean_details else v->'details' end,
    v_owner_head_id, v_owner_head_name,
    v_region_id, v_region_name, v_is_waitlist
  )
  returning id into v_id;
  return v_id;
end $function$;
revoke execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) from public, anon;
grant execute on function public.create_typed_draft(public.request_type, text, numeric, text, jsonb, uuid) to authenticated;

-- 10. Complete submit_request with shop auto-assign prior to null check --------
create or replace function public.submit_request(p_request_id uuid)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles; r public.requests; rh public.profiles; v_no text; n int; v_rh_count int;
  v_next public.request_status; v_cat_ok boolean; v_shop_ids uuid[];
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request cannot be submitted'; end if;

  -- General / Non-Cash: one associated shop is auto-assigned; several need a choice.
  if r.request_type in ('general', 'non_cash') and r.shop_id is null then
    v_shop_ids := public._user_shop_ids(me.id);
    if cardinality(v_shop_ids) = 1 then
      update public.requests
         set shop_id = v_shop_ids[1],
             shop_name = (select s.name from public.shops s where s.id = v_shop_ids[1])
       where id = r.id;
      r.shop_id := v_shop_ids[1];
    elsif cardinality(v_shop_ids) > 1 then
      raise exception 'Select the shop for this request (you are assigned to more than one shop)';
    end if;
  end if;

  -- Requester profile must be complete (shop required for employee unless stock transfer specifies it)
  if r.shop_id is null and me.shop_id is null and me.role = 'employee' and r.request_type <> 'stock_transfer' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  -- Title and amount sanity (non_cash and stock_transfer are exempt from monetary payment requirement)
  if r.request_type not in ('non_cash', 'stock_transfer') and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if not (r.request_type = any(me.allowed_types) or (r.request_type = 'asset_below_20k' and 'asset'::public.request_type = any(me.allowed_types)) or me.role in ('admin', 'head')) then
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

  -- Work category (only needed when several clerks split the target department's work).
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
    if r.amount > 20000 then
      raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k';
    end if;
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 1 then raise exception 'Attach at least 1 bill or quotation with vendor name and amount'; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  -- Routing target for employees: check Regional Head
  if me.role = 'employee' then
    if me.regional_head_id is not null then
      select * into rh from public.profiles p
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

-- 11. Complete update_typed_draft (supports non_cash cleanly and records shop) -
create or replace function public.update_typed_draft(
  p_request_id uuid,
  p_title text,
  p_amount numeric,
  p_notes text default null::text,
  p_details jsonb default null::jsonb
)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  me public.profiles;
  r public.requests;
  v jsonb;
  v_title text;
  v_shop_id uuid;
  v_shop_name text;
  v_clean_details jsonb;
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
  elsif r.request_type in ('general', 'non_cash') and v_shop_id is null then
    v_shop_id := public._resolve_request_shop(me, null);
    select name into v_shop_name from public.shops where id = v_shop_id;
  end if;

  if r.request_type = 'stock_transfer' and (v->'details'->>'from_shop_id') ~ '^[0-9a-fA-F-]{36}$' then
    v_shop_id := (v->'details'->>'from_shop_id')::uuid;
    v_shop_name := coalesce(v->'details'->>'from_shop_name', (select name from public.shops where id = v_shop_id));
  end if;

  update public.requests set
    title = left(v_title, 200),
    amount = case when r.request_type = 'non_cash' then 0 else (v->>'amount')::numeric end,
    notes = nullif(btrim(p_notes), ''),
    details = case when r.request_type = 'non_cash' then coalesce(v_clean_details, r.details) else v->'details' end,
    shop_id = v_shop_id,
    shop_name = v_shop_name,
    updated_at = now()
  where id = r.id;
  if r.request_type = 'asset' or r.request_type = 'asset_below_20k' then
    perform public._sync_asset_amount(r.id);
  end if;
end $function$;
revoke execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) from public, anon;
grant execute on function public.update_typed_draft(uuid, text, numeric, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
