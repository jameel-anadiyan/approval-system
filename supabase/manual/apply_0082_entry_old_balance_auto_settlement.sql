-- ============================================================================
-- apply_0082_entry_old_balance_auto_settlement.sql
--
-- Feature:
-- When a user in an Entry-Only disbursement account records an entry with
-- an Old Balance / Old Advance adjustment covering the entire request
-- (or remaining balance), the request and entry are AUTOMATICALLY closed
-- and marked as 'paid' through 'Old Balance / Old Advance'.
--
-- Key behaviors:
-- 1. Does NOT route to Entry Approver (verifying) - status is set directly to 'paid'.
-- 2. Does NOT route to Cash / Bank cashier desk (cashacc) - no cashier action needed.
-- 3. The request is closed directly from the Entry Only account itself:
--    - requests.status = 'paid'
--    - requests.payment_mode = 'Old Balance / Old Advance'
--    - requests.payment_remarks = 'Paid through old balance / old advance adjustment'
--    - requests.paid_by = entry user id
--    - requests.paid_at = now()
--    - disbursement_entries.entry_type = 'old_balance'
--    - disbursement_entries.paid_amount = adjustment_amount
--    - disbursement_entries.status = 'paid'
--    - disbursement_entries.paid_at = now()
--    - disbursement_entries.paid_by = entry user id
-- 4. Entry type check constraint extended to include 'old_balance'.
-- 5. If amount is accidentally left equal to adjustment or entered together,
--    the system seamlessly treats the full amount as Old Balance adjustment (amt = 0).
-- ============================================================================

-- 1. Clean up old/restrictive amount & adjustment constraints on disbursement_entries
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.disbursement_entries'::regclass
       and contype = 'c'
       and (conname ilike '%adjustment%' or conname ilike '%amount%')
       and conname not in ('disbursement_entries_tds_amount_check')
  loop
    execute 'alter table public.disbursement_entries drop constraint if exists ' || quote_ident(c.conname);
  end loop;
end $$;

-- Explicit drops as an extra safeguard
alter table public.disbursement_entries drop constraint if exists disbursement_entries_adjustment_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_adjustment_amount_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_amount_check;
alter table public.disbursement_entries drop constraint if exists disbursement_entries_amounts_check;

-- Allow amount = 0 when entry carries an adjustment (amount >= 0, adjustment >= 0, amount + adjustment > 0)
alter table public.disbursement_entries
  add constraint disbursement_entries_amounts_check
  check (amount >= 0 and coalesce(adjustment_amount, 0) >= 0 and (amount + coalesce(adjustment_amount, 0)) > 0);

-- Extend entry_type check constraint on disbursement_entries
alter table public.disbursement_entries drop constraint if exists disbursement_entries_entry_type_check;
alter table public.disbursement_entries
  add constraint disbursement_entries_entry_type_check
  check (entry_type in ('cash', 'bank', 'old_balance'));

-- 2. Drop existing add_disbursement_entry overloads to prevent signature conflicts
do $$
declare
  f record;
begin
  for f in
    select distinct oid::regprocedure::text as sig
      from pg_proc
     where proname = 'add_disbursement_entry'
       and pronamespace = 'public'::regnamespace
  loop
    execute 'drop function ' || f.sig;
  end loop;
end $$;

-- 3. Recreate add_disbursement_entry with auto-settlement for Old Balance
create or replace function public.add_disbursement_entry(
  p_request_id uuid,
  p_amount numeric,
  p_tds_cut boolean default false,
  p_notes text default null,
  p_adjustment numeric default 0,
  p_entry_type text default 'bank',
  p_session_id text default null,
  p_tds_amount numeric default 0,
  p_passkey text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  person public.disbursement_account_persons;
  r public.requests;
  v_next_no int;
  v_amt numeric;
  v_adj numeric;
  v_tds numeric;
  v_entry_id uuid;
  v_available numeric;
  v_payment_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_paid numeric;
  v_full boolean := false;
  v_adjust_only boolean;
  v_notes text := nullif(btrim(p_notes), '');
  v_type text := coalesce(lower(btrim(p_entry_type)), 'bank');
  v_by text;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'entry_only') then
    raise exception 'Permission denied: Only Entry-Only or Admin disbursement accounts can create entries';
  end if;

  -- Verify passkey
  if me.role <> 'admin' then
    person := public._verify_account_person(me.id, p_passkey);
  end if;
  v_by := coalesce(person.person_name, me.full_name);

  if v_type not in ('cash', 'bank', 'old_balance', 'adjustment') then
    raise exception 'Entry type must be either cash, bank, or old_balance';
  end if;

  -- Concurrent session lock check
  if exists (
    select 1 from public.request_entry_locks
     where request_id = p_request_id
       and last_heartbeat_at >= (now() - interval '45 seconds')
       and (p_session_id is null or session_id <> p_session_id)
  ) then
    raise exception 'This request is currently open on another computer. Please wait for that computer to close it.';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type in ('discount', 'non_cash', 'stock_transfer') then raise exception 'Not found'; end if;
  if r.status <> 'approved' then raise exception 'Entries can only be created for approved requests waiting for payment'; end if;

  if exists (
    select 1 from public.disbursement_clarifications
     where request_id = r.id and status = 'pending_head'
  ) then
    raise exception 'This request has a clarification pending with the Request Owner Head. Entries cannot be added until answered.';
  end if;

  if me.role <> 'admin' and r.assigned_entry_user_id is not null and r.assigned_entry_user_id <> me.id then
    raise exception 'This request has been assigned to % for disbursement entries', coalesce(r.assigned_entry_user_name, 'another entry officer');
  end if;

  v_available := round(r.amount - coalesce(r.paid_amount, 0) - public._entry_reserved(r.id), 2);
  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);

  -- Seamless Old Balance resolution:
  -- If entry type is old_balance or adjustment:
  if v_type in ('old_balance', 'adjustment') then
    if v_adj <= 0 and v_amt > 0 then
      v_adj := v_amt;
    end if;
    v_amt := 0;
    v_type := 'old_balance';
  end if;

  -- If adjustment covers the entire available balance or equals the amount entered:
  if v_adj > 0 and (v_adj >= v_available or (v_amt > 0 and v_adj = v_amt)) then
    v_amt := 0;
    v_type := 'old_balance';
    if v_adj > v_available then
      v_adj := v_available;
    end if;
  end if;

  v_adjust_only := (v_amt = 0 and v_adj > 0);
  v_tds := case when coalesce(p_tds_cut, false) and not v_adjust_only then round(coalesce(p_tds_amount, 0), 2) else 0 end;

  if v_amt < 0 then raise exception 'Entry amount cannot be negative'; end if;
  if v_adj < 0 then raise exception 'Old balance / advance adjustment cannot be negative'; end if;
  if v_amt + v_adj <= 0 then raise exception 'Enter an entry amount or an old balance / advance adjustment'; end if;

  if not v_adjust_only then
    if coalesce(p_tds_cut, false) and v_tds <= 0 then
      raise exception 'TDS is marked as cut - enter the TDS amount';
    end if;
    if v_amt + v_adj + v_tds > v_available then
      raise exception 'Entry ₹% + TDS ₹% + adjustment ₹% is more than the balance available for entries (₹%)',
        v_amt, v_tds, v_adj, greatest(v_available, 0);
    end if;
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_next_no
    from public.disbursement_entries where request_id = r.id;

  insert into public.disbursement_entries (
    request_id, entry_no, amount, adjustment_amount, tds_cut, tds_amount, status, notes, entry_type,
    created_by, created_by_name, created_by_person_id, created_by_person_name,
    paid_amount, paid_at, paid_by, paid_by_name, paid_by_person_id, paid_by_person_name
  ) values (
    r.id, v_next_no, v_amt, v_adj, coalesce(p_tds_cut, false) and not v_adjust_only, v_tds,
    case when v_adjust_only then 'paid' else 'pending_approval' end,
    v_notes, v_type, me.id, me.full_name, person.id, person.person_name,
    case when v_adjust_only then v_adj else 0 end,
    case when v_adjust_only then now() else null end,
    case when v_adjust_only then me.id else null end,
    case when v_adjust_only then me.full_name else null end,
    case when v_adjust_only then person.id else null end,
    case when v_adjust_only then person.person_name else null end
  ) returning id into v_entry_id;

  -- Old balance / advance adjustment is settled immediately
  if v_adj > 0 then
    insert into public.request_payments (
      request_id, amount, payment_date, payment_mode, payment_ref, remarks,
      paid_by, paid_by_name, paid_by_person_name, entry_id, is_adjustment
    ) values (
      r.id, v_adj, v_today, 'Old Balance / Old Advance', null,
      left('Paid through old balance / old advance adjustment · Entry #' || v_next_no || coalesce(' · ' || v_notes, ''), 500),
      me.id, me.full_name, person.person_name, v_entry_id, true
    ) returning id into v_payment_id;

    update public.disbursement_entries set
      adjustment_payment_id = v_payment_id,
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
        payment_mode = 'Old Balance / Old Advance',
        payment_ref = null,
        payment_remarks = coalesce(v_notes, 'Paid through old balance / old advance adjustment'),
        updated_at = now()
      where id = r.id;

      perform public._log_action(
        r.id, me, 'paid', 'approved', 'paid',
        'Entry #' || v_next_no || ' · ₹' || to_char(v_adj, 'FM999999999990.00')
          || ' settled by old balance / advance adjustment · Closed & marked Paid in full directly from Entry account',
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

  -- Only notify Entry Approvers if there is an amount to be verified & paid via cash/bank desk
  if not v_adjust_only then
    perform public._log_action(
      r.id, me, 'disbursement_entry_created', r.status, r.status,
      'Entry #' || v_next_no || ' (' || upper(v_type) || ') made by ' || v_by
        || ': ₹' || to_char(v_amt, 'FM999999999990.00') || ' to pay'
        || case when v_tds > 0 then ' · TDS cut ₹' || to_char(v_tds, 'FM999999999990.00')
                when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
        || case when v_adj > 0
                then ' · Old balance / advance adjusted ₹' || to_char(v_adj, 'FM999999999990.00')
                else '' end
        || ' (Pending Approver sign-off)'
        || coalesce(' · ' || v_notes, ''),
      true
    );

    perform public._notify(
      (select array_agg(id) from public.profiles
        where is_active and (role = 'admin' or (role = 'disbursement' and disbursement_type = 'entry_approver'))),
      r.id,
      'Entry #' || v_next_no || ' waiting for verification',
      coalesce(r.request_no, 'Request') || ': ₹' || to_char(v_amt, 'FM999999999990.00') || ' (' || upper(v_type) || ') by ' || v_by
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'entry_no', v_next_no,
    'amount', v_amt,
    'entry_type', v_type,
    'adjustment_amount', v_adj,
    'tds_cut', coalesce(p_tds_cut, false) and not v_adjust_only,
    'tds_amount', v_tds,
    'status', case when v_adjust_only then 'paid' else 'pending_approval' end,
    'fully_paid', v_full
  );
end $$;

revoke execute on function public.add_disbursement_entry(uuid, numeric, boolean, text, numeric, text, text, numeric, text) from public, anon;
grant execute on function public.add_disbursement_entry(uuid, numeric, boolean, text, numeric, text, text, numeric, text) to authenticated;

-- 4. Recreate edit_rejected_disbursement_entry to support Old Balance settlement
create or replace function public.edit_rejected_disbursement_entry(
  p_entry_id uuid,
  p_amount numeric,
  p_entry_type text,
  p_tds_cut boolean default false,
  p_notes text default null,
  p_adjustment numeric default 0,
  p_tds_amount numeric default 0,
  p_passkey text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  person public.disbursement_account_persons;
  e public.disbursement_entries;
  r public.requests;
  v_amt numeric;
  v_adj numeric;
  v_old_adj numeric;
  v_tds numeric;
  v_type text;
  v_available numeric;
  v_payment_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_notes text := nullif(btrim(p_notes), '');
  v_by text;
  v_adjust_only boolean;
  v_full boolean := false;
  v_paid numeric;
begin
  me := public._me();
  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;

  if e.status <> 'rejected' then
    raise exception 'Only rejected entries can be edited. Current status is %', e.status;
  end if;
  if coalesce(e.paid_amount, 0) > 0 then
    raise exception 'This entry is already partly paid and cannot be edited';
  end if;

  if me.role <> 'admin' and (me.id is distinct from e.created_by) then
    raise exception 'Permission denied: Only the entry account that created this entry can edit it';
  end if;

  if me.role <> 'admin' then
    person := public._verify_account_person(me.id, p_passkey);
    if e.created_by_person_id is not null and e.created_by_person_id <> person.id then
      raise exception 'Only % (who made this entry) can correct and resubmit it. Enter that person''s passkey.',
        coalesce(e.created_by_person_name, 'the person who made it');
    end if;
  end if;
  v_by := coalesce(person.person_name, e.created_by_person_name, me.full_name);

  select * into r from public.requests where id = e.request_id for update;
  if r.status <> 'approved' then raise exception 'Request is no longer waiting for payment'; end if;

  v_type := coalesce(lower(btrim(p_entry_type)), e.entry_type, 'bank');
  if v_type not in ('cash', 'bank', 'old_balance', 'adjustment') then
    raise exception 'Entry mode must be cash, bank, or old_balance';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);
  v_old_adj := coalesce(e.adjustment_amount, 0);

  v_available := round(
    r.amount - coalesce(r.paid_amount, 0) + v_old_adj - public._entry_reserved(r.id, e.id), 2);

  if v_type in ('old_balance', 'adjustment') then
    if v_adj <= 0 and v_amt > 0 then v_adj := v_amt; end if;
    v_amt := 0;
    v_type := 'old_balance';
  end if;

  if v_adj > 0 and (v_adj >= v_available or (v_amt > 0 and v_adj = v_amt)) then
    v_amt := 0;
    v_type := 'old_balance';
    if v_adj > v_available then v_adj := v_available; end if;
  end if;

  v_adjust_only := (v_amt = 0 and v_adj > 0);
  v_tds := case when coalesce(p_tds_cut, false) and not v_adjust_only then round(coalesce(p_tds_amount, 0), 2) else 0 end;

  if v_amt < 0 then raise exception 'Entry amount cannot be negative'; end if;
  if v_adj < 0 then raise exception 'Adjustment amount cannot be negative'; end if;
  if v_amt + v_adj <= 0 then raise exception 'Enter an entry amount or an old balance / advance adjustment'; end if;

  if not v_adjust_only then
    if coalesce(p_tds_cut, false) and v_tds <= 0 then
      raise exception 'TDS is marked as cut - enter the TDS amount';
    end if;
    if v_amt + v_adj + v_tds > v_available then
      raise exception 'Corrected amount ₹% (entry + TDS + adjustment) exceeds balance available (₹%)',
        v_amt + v_adj + v_tds, greatest(v_available, 0);
    end if;
  end if;

  -- Keep the settled old-balance adjustment in step with the correction
  if v_adj <> v_old_adj then
    if v_old_adj > 0 and e.adjustment_payment_id is not null then
      if v_adj > 0 then
        update public.request_payments set amount = v_adj where id = e.adjustment_payment_id;
        v_payment_id := e.adjustment_payment_id;
      else
        delete from public.request_payments where id = e.adjustment_payment_id;
        v_payment_id := null;
      end if;
    elsif v_adj > 0 then
      insert into public.request_payments (
        request_id, amount, payment_date, payment_mode, payment_ref, remarks,
        paid_by, paid_by_name, paid_by_person_name, entry_id, is_adjustment
      ) values (
        r.id, v_adj, v_today, 'Old Balance / Old Advance', null,
        left('Paid through old balance / old advance adjustment · Entry #' || e.entry_no || coalesce(' · ' || v_notes, ''), 500),
        me.id, me.full_name, v_by, e.id, true
      ) returning id into v_payment_id;
    end if;

    update public.requests
       set paid_amount = greatest(0, coalesce(paid_amount, 0) + (v_adj - v_old_adj)),
           updated_at = now()
     where id = r.id;
  else
    v_payment_id := e.adjustment_payment_id;
  end if;

  v_paid := greatest(0, coalesce(r.paid_amount, 0) + (v_adj - v_old_adj));
  v_full := v_paid >= r.amount and v_adjust_only;

  update public.disbursement_entries set
    amount = v_amt,
    entry_type = v_type,
    tds_cut = coalesce(p_tds_cut, false) and not v_adjust_only,
    tds_amount = v_tds,
    tds_settled = false,
    approved_amount = null,
    notes = v_notes,
    adjustment_amount = v_adj,
    adjustment_payment_id = v_payment_id,
    payment_id = case when v_adjust_only then v_payment_id else payment_id end,
    paid_amount = case when v_adjust_only then v_adj else paid_amount end,
    paid_at = case when v_adjust_only then now() else paid_at end,
    paid_by = case when v_adjust_only then me.id else paid_by end,
    paid_by_name = case when v_adjust_only then me.full_name else paid_by_name end,
    paid_by_person_id = case when v_adjust_only then person.id else paid_by_person_id end,
    paid_by_person_name = case when v_adjust_only then person.person_name else paid_by_person_name end,
    created_by_person_id = coalesce(e.created_by_person_id, person.id),
    created_by_person_name = coalesce(e.created_by_person_name, person.person_name),
    status = case when v_adjust_only then 'paid' else 'pending_approval' end,
    rejection_reason = null,
    rejected_by = null,
    rejected_by_name = null,
    rejected_at = null,
    updated_at = now()
  where id = e.id;

  if v_full then
    update public.requests set
      status = 'paid',
      paid_amount = v_paid,
      paid_by = me.id,
      paid_at = now(),
      payment_date = v_today,
      payment_mode = 'Old Balance / Old Advance',
      payment_ref = null,
      payment_remarks = coalesce(v_notes, 'Paid through old balance / old advance adjustment'),
      updated_at = now()
    where id = r.id;

    perform public._log_action(
      r.id, me, 'paid', 'approved', 'paid',
      'Entry #' || e.entry_no || ' · ₹' || to_char(v_adj, 'FM999999999990.00')
        || ' settled by old balance / advance adjustment · Closed & marked Paid in full directly from Entry account',
      true
    );
    perform public.notify_next_actor(r.id, 'paid');
  elsif not v_adjust_only then
    perform public._log_action(
      r.id, me, 'disbursement_entry_corrected', r.status, r.status,
      'Entry #' || e.entry_no || ' corrected & resubmitted by ' || v_by
        || ': ₹' || to_char(v_amt, 'FM999999999990.00')
        || ' (' || upper(v_type) || ')'
        || case when v_tds > 0 then ' · TDS cut ₹' || to_char(v_tds, 'FM999999999990.00')
                when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
        || ' (Pending Approver sign-off)',
      true
    );

    perform public._notify(
      (select array_agg(id) from public.profiles
        where is_active and (role = 'admin' or (role = 'disbursement' and disbursement_type = 'entry_approver'))),
      r.id,
      'Entry #' || e.entry_no || ' corrected & resubmitted',
      coalesce(r.request_no, 'Request') || ': ₹' || to_char(v_amt, 'FM999999999990.00') || ' (' || upper(v_type) || ') pending verification'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', v_amt,
    'status', case when v_adjust_only then 'paid' else 'pending_approval' end,
    'fully_paid', v_full
  );
end $$;

revoke execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric, numeric, text) from public, anon;
grant execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';

