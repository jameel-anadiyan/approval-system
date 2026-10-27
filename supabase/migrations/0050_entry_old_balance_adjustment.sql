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

notify pgrst, 'reload schema';
