-- ============================================================================
-- 0042_disbursement_entry_and_payment_accounts.sql
-- Two types of Disbursement accounts:
-- 1. Entry Only: Creates payment entries against approved requests.
--    - Automatic entry numbering starting from 1 for each request.
--    - Amount input.
--    - Checkbox to indicate if TDS was cut or not cut.
-- 2. Payment Only: Pays the exact amount against each entry.
--    - When paid, the entry is marked 'paid'.
--    - Standard payment mode, date, ref, remarks settings.
--    - Maximum amount payable is capped against each entry.
-- ============================================================================

-- 1. Add disbursement_type to profiles
alter table public.profiles
  add column if not exists disbursement_type text check (disbursement_type is null or disbursement_type in ('entry_only', 'payment_only'));

-- Set default for existing disbursement users if any
update public.profiles
  set disbursement_type = 'payment_only'
  where role = 'disbursement' and disbursement_type is null;

-- 2. Create disbursement_entries table
create table if not exists public.disbursement_entries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  entry_no int not null,
  amount numeric(14,2) not null check (amount > 0),
  tds_cut boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  paid_by_name text,
  payment_id uuid references public.request_payments(id) on delete set null,
  unique(request_id, entry_no)
);

create index if not exists disbursement_entries_request_idx on public.disbursement_entries(request_id, entry_no);

-- 3. Add entry_id to request_payments
alter table public.request_payments
  add column if not exists entry_id uuid references public.disbursement_entries(id) on delete set null;

-- 4. Enable RLS on disbursement_entries
alter table public.disbursement_entries enable row level security;
revoke all on public.disbursement_entries from anon;
revoke insert, update, delete, truncate on public.disbursement_entries from authenticated;
grant select on public.disbursement_entries to authenticated;

drop policy if exists disbursement_entries_select on public.disbursement_entries;
create policy disbursement_entries_select on public.disbursement_entries for select to authenticated
  using (public.can_view_request(request_id));

-- 5. RPC: add_disbursement_entry
create or replace function public.add_disbursement_entry(
  p_request_id uuid,
  p_amount numeric,
  p_tds_cut boolean default false,
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_next_no int;
  v_amt numeric;
  v_entry_id uuid;
  v_existing_sum numeric;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or me.disbursement_type = 'payment_only') then
    raise exception 'Permission denied: Only Entry-Only or Admin disbursement accounts can create entries';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type = 'discount' then raise exception 'Not found'; end if;
  if r.status <> 'approved' then raise exception 'Entries can only be created for approved requests waiting for payment'; end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Entry amount must be more than zero'; end if;

  select coalesce(sum(amount), 0) into v_existing_sum
  from public.disbursement_entries
  where request_id = r.id and status <> 'cancelled';

  if v_existing_sum + v_amt > r.amount then
    raise exception 'Total entries (₹%) cannot exceed the approved request amount of ₹% (remaining available: ₹%)',
      round(v_existing_sum + v_amt, 2), r.amount, round(r.amount - v_existing_sum, 2);
  end if;

  -- Automatic entry numbering starting from 1 for each request
  select coalesce(max(entry_no), 0) + 1 into v_next_no
  from public.disbursement_entries
  where request_id = r.id;

  insert into public.disbursement_entries (
    request_id, entry_no, amount, tds_cut, status, notes, created_by, created_by_name
  ) values (
    r.id, v_next_no, v_amt, coalesce(p_tds_cut, false), 'pending',
    nullif(btrim(p_notes), ''), me.id, me.full_name
  ) returning id into v_entry_id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_created', r.status, r.status,
    'Entry #' || v_next_no || ' added: ₹' || to_char(v_amt, 'FM999999999990.00')
      || case when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
      || coalesce(' · ' || nullif(btrim(p_notes), ''), ''),
    true
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'entry_no', v_next_no,
    'amount', v_amt,
    'tds_cut', coalesce(p_tds_cut, false)
  );
end $$;
revoke execute on function public.add_disbursement_entry(uuid, numeric, boolean, text) from public, anon;
grant execute on function public.add_disbursement_entry(uuid, numeric, boolean, text) to authenticated;

-- 6. RPC: cancel_disbursement_entry
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
  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status = 'paid' then raise exception 'Cannot cancel an entry that has already been paid'; end if;

  select * into r from public.requests where id = e.request_id for update;
  if me.role <> 'admin' and (me.role <> 'disbursement' or me.disbursement_type = 'payment_only') then
    raise exception 'Permission denied: Only Entry-Only or Admin disbursement accounts can cancel entries';
  end if;

  delete from public.disbursement_entries where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_cancelled', r.status, r.status,
    'Entry #' || e.entry_no || ' (₹' || to_char(e.amount, 'FM999999999990.00') || ') removed'
      || coalesce(' · ' || nullif(btrim(p_reason), ''), ''),
    true
  );

  return jsonb_build_object('success', true, 'deleted_id', p_entry_id);
end $$;
revoke execute on function public.cancel_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.cancel_disbursement_entry(uuid, text) to authenticated;

-- 7. RPC: pay_disbursement_entry (Payment Only account)
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
  v_date date;
  v_payment_id uuid;
  v_paid numeric;
  v_full boolean;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or me.disbursement_type = 'entry_only') then
    raise exception 'Permission denied: Only Payment-Only or Admin accounts can disburse payments';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending' then raise exception 'This entry has already been paid or cancelled'; end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.id is null or r.request_type = 'discount' then raise exception 'Request not found'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be paid'; end if;

  -- The maximum amount that can be paid is against this entry:
  v_amt := round(coalesce(p_amount, e.amount), 2);
  if v_amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  if v_amt > e.amount then
    raise exception 'Payment amount (₹%) cannot exceed Entry #% amount of ₹%', v_amt, e.entry_no, e.amount;
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

  v_paid := r.paid_amount + v_amt;
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

-- 8. RPC: set_user_disbursement_type (Admin only)
create or replace function public.set_user_disbursement_type(
  p_user_id uuid,
  p_type text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  target public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can set disbursement account type'; end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null then raise exception 'User not found'; end if;
  if target.role <> 'disbursement' then raise exception 'User is not a disbursement account'; end if;
  if p_type is not null and p_type not in ('entry_only', 'payment_only') then
    raise exception 'Invalid disbursement type. Must be entry_only or payment_only';
  end if;

  update public.profiles set disbursement_type = p_type, updated_at = now() where id = p_user_id;
  return jsonb_build_object('success', true, 'user_id', p_user_id, 'disbursement_type', p_type);
end $$;
revoke execute on function public.set_user_disbursement_type(uuid, text) from public, anon;
grant execute on function public.set_user_disbursement_type(uuid, text) to authenticated;

-- 9. Update existing add_payment to respect Entry-Only restrictions
create or replace function public.add_payment(
  p_request_id uuid, p_amount numeric, p_payment_date date default null, p_payment_mode text default null,
  p_payment_ref text default null, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests;
  v_amt numeric; v_balance numeric; v_paid numeric; v_date date; v_full boolean;
begin
  me := public._me();
  if me.role <> 'admin' and me.role <> 'disbursement' then
    raise exception 'Only Disbursement or Admin can record payments';
  end if;
  if me.role = 'disbursement' and me.disbursement_type = 'entry_only' then
    raise exception 'Permission denied: Entry-only accounts cannot record payments';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type = 'discount' then raise exception 'Not found'; end if;
  if r.status = 'paid' then raise exception 'This request is already fully paid'; end if;
  if r.status <> 'approved' then raise exception 'Only approved requests can be paid'; end if;

  v_balance := r.amount - r.paid_amount;
  v_amt := round(coalesce(p_amount, v_balance), 2);
  if v_amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  if v_amt > v_balance then
    raise exception 'Payment of % is more than the balance of %', v_amt, v_balance;
  end if;
  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date);
  if v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Payment date cannot be in the future'; end if;

  insert into public.request_payments (request_id, amount, payment_date, payment_mode, payment_ref, remarks, paid_by, paid_by_name)
  values (r.id, v_amt, v_date, nullif(btrim(p_payment_mode), ''), nullif(btrim(p_payment_ref), ''),
          nullif(btrim(p_remarks), ''), me.id, me.full_name);

  v_paid := r.paid_amount + v_amt;
  v_full := v_paid >= r.amount;

  if v_full then
    update public.requests set status = 'paid', paid_amount = v_paid, paid_by = me.id, paid_at = now(),
      payment_date = v_date, payment_mode = nullif(btrim(p_payment_mode), ''),
      payment_ref = nullif(btrim(p_payment_ref), ''), payment_remarks = nullif(btrim(p_remarks), ''),
      updated_at = now()
    where id = r.id;
    perform public._log_action(r.id, me, 'paid', 'approved', 'paid',
      case when r.paid_amount > 0 then 'Final payment ₹' || to_char(v_amt, 'FM999999999990.00')
           else nullif(btrim(p_remarks), '') end, true);
    perform public.notify_next_actor(r.id, 'paid');
  else
    update public.requests set paid_amount = v_paid, updated_at = now() where id = r.id;
    perform public._log_action(r.id, me, 'partial_payment', 'approved', 'approved',
      'Paid ₹' || to_char(v_amt, 'FM999999999990.00') || ' · balance ₹' || to_char(r.amount - v_paid, 'FM999999999990.00')
      || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''), true);
    perform public._notify(array[r.requester_id], r.id, 'Partial payment received',
      coalesce(r.request_no, 'Request') || ' - ₹' || to_char(v_amt, 'FM999999999990.00') || ' paid, balance ₹' || to_char(r.amount - v_paid, 'FM999999999990.00'));
  end if;

  return jsonb_build_object('success', true, 'amount', v_amt, 'fully_paid', v_full);
end $$;
revoke execute on function public.add_payment(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.add_payment(uuid, numeric, date, text, text, text) to authenticated;

notify pgrst, 'reload schema';
