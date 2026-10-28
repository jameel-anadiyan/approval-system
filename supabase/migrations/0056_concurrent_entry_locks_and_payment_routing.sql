-- ============================================================================
-- 0056_concurrent_entry_locks_and_payment_routing.sql
--
-- Features:
-- 1. Concurrent Entry Session Lock:
--    Multiple physical persons may share the same Entry Only account login across
--    different computers. When one computer opens a request for entry, another
--    computer cannot open or add entries to the same request until the first
--    session is closed or timed out (45s heartbeat).
--
-- 2. Strict Entry Account Linked Payment Person Routing:
--    Only payment accounts specifically linked to the entry account (or Admin)
--    can disburse payment against that entry.
-- ============================================================================

-- 1. Create table for concurrent request entry locks
create table if not exists public.request_entry_locks (
  request_id uuid primary key references public.requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text,
  session_id text not null,
  client_label text,
  locked_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now()
);

create index if not exists request_entry_locks_user_session_idx
  on public.request_entry_locks(user_id, session_id);

-- Enable RLS
alter table public.request_entry_locks enable row level security;
grant select on public.request_entry_locks to authenticated;

drop policy if exists request_entry_locks_select on public.request_entry_locks;
create policy request_entry_locks_select on public.request_entry_locks
  for select to authenticated using (true);

-- 2. RPC: acquire_entry_lock
create or replace function public.acquire_entry_lock(
  p_request_id uuid,
  p_session_id text,
  p_client_label text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  l public.request_entry_locks;
begin
  me := public._me();
  if me.id is null then raise exception 'Not authenticated'; end if;

  -- Remove expired locks (heartbeat older than 45 seconds)
  delete from public.request_entry_locks
  where request_id = p_request_id
    and last_heartbeat_at < (now() - interval '45 seconds');

  -- Check existing lock
  select * into l from public.request_entry_locks
  where request_id = p_request_id for update;

  if l.request_id is not null then
    if l.session_id = p_session_id then
      -- Same session: refresh heartbeat
      update public.request_entry_locks
      set last_heartbeat_at = now(),
          client_label = coalesce(p_client_label, client_label)
      where request_id = p_request_id;

      return jsonb_build_object(
        'success', true,
        'locked', true,
        'is_owner', true,
        'session_id', p_session_id
      );
    else
      -- Locked by another computer/tab
      return jsonb_build_object(
        'success', false,
        'locked', true,
        'is_owner', false,
        'locked_by_user_id', l.user_id,
        'locked_by_name', l.user_name,
        'session_id', l.session_id,
        'client_label', l.client_label,
        'locked_at', l.locked_at,
        'last_heartbeat_at', l.last_heartbeat_at
      );
    end if;
  end if;

  -- Insert new lock
  insert into public.request_entry_locks (
    request_id, user_id, user_name, session_id, client_label, locked_at, last_heartbeat_at
  ) values (
    p_request_id, me.id, me.full_name, p_session_id, p_client_label, now(), now()
  );

  return jsonb_build_object(
    'success', true,
    'locked', true,
    'is_owner', true,
    'session_id', p_session_id
  );
end $$;

grant execute on function public.acquire_entry_lock(uuid, text, text) to authenticated;

-- 3. RPC: heartbeat_entry_lock
create or replace function public.heartbeat_entry_lock(
  p_request_id uuid,
  p_session_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.request_entry_locks;
begin
  select * into l from public.request_entry_locks
  where request_id = p_request_id for update;

  if l.request_id is null then
    return jsonb_build_object('success', false, 'error', 'No active lock found');
  end if;

  if l.session_id <> p_session_id then
    return jsonb_build_object(
      'success', false,
      'error', 'Lock is held by another computer/session',
      'locked_by_name', l.user_name,
      'client_label', l.client_label
    );
  end if;

  update public.request_entry_locks
  set last_heartbeat_at = now()
  where request_id = p_request_id;

  return jsonb_build_object('success', true);
end $$;

grant execute on function public.heartbeat_entry_lock(uuid, text) to authenticated;

-- 4. RPC: release_entry_lock
create or replace function public.release_entry_lock(
  p_request_id uuid,
  p_session_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  delete from public.request_entry_locks
  where request_id = p_request_id and session_id = p_session_id;

  return jsonb_build_object('success', true);
end $$;

grant execute on function public.release_entry_lock(uuid, text) to authenticated;

-- 5. RPC: check_entry_lock
create or replace function public.check_entry_lock(
  p_request_id uuid,
  p_session_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.request_entry_locks;
begin
  -- Clear stale locks
  delete from public.request_entry_locks
  where request_id = p_request_id
    and last_heartbeat_at < (now() - interval '45 seconds');

  select * into l from public.request_entry_locks
  where request_id = p_request_id;

  if l.request_id is null then
    return jsonb_build_object('locked', false);
  end if;

  return jsonb_build_object(
    'locked', true,
    'is_owner', (p_session_id is not null and l.session_id = p_session_id),
    'locked_by_user_id', l.user_id,
    'locked_by_name', l.user_name,
    'client_label', l.client_label,
    'locked_at', l.locked_at,
    'last_heartbeat_at', l.last_heartbeat_at
  );
end $$;

grant execute on function public.check_entry_lock(uuid, text) to authenticated;

-- 6. Update add_disbursement_entry to check session lock if provided
create or replace function public.add_disbursement_entry(
  p_request_id uuid,
  p_amount numeric,
  p_tds_cut boolean default false,
  p_notes text default null,
  p_entry_type text default 'bank',
  p_old_balance numeric default null,
  p_session_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.requests;
  v_next_no int;
  v_amt numeric;
  v_entry_id uuid;
  v_existing_sum numeric;
  v_entry_type text;
  v_old_bal numeric;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or me.disbursement_type <> 'entry_only') then
    raise exception 'Permission denied: Only Entry-Only disbursement accounts can create entries';
  end if;

  -- Concurrent lock check: ensure another session doesn't hold the lock
  if exists (
    select 1 from public.request_entry_locks
    where request_id = p_request_id
      and last_heartbeat_at >= (now() - interval '45 seconds')
      and (p_session_id is null or session_id <> p_session_id)
  ) then
    raise exception 'This request is currently open on another computer. Please wait for that computer to close it.';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Not found';
  end if;
  if r.status <> 'approved' then
    raise exception 'Entries can only be created for approved requests waiting for payment';
  end if;

  if exists (
    select 1 from public.disbursement_clarifications
    where request_id = r.id and status = 'pending_head'
  ) then
    raise exception 'This request has a clarification pending with the Request Owner Head. Entries cannot be added until answered.';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 then raise exception 'Entry amount must be more than zero'; end if;

  select coalesce(sum(amount), 0) into v_existing_sum
  from public.disbursement_entries
  where request_id = r.id and status <> 'cancelled';

  if v_existing_sum + v_amt > r.amount then
    raise exception 'Total entries (₹%) cannot exceed the approved request amount of ₹% (remaining available: ₹%)',
      round(v_existing_sum + v_amt, 2), r.amount, round(r.amount - v_existing_sum, 2);
  end if;

  v_entry_type := lower(coalesce(p_entry_type, 'bank'));
  if v_entry_type not in ('cash', 'bank') then
    raise exception 'Entry type must be either cash or bank';
  end if;

  v_old_bal := case when p_old_balance is not null then round(p_old_balance, 2) else null end;

  select coalesce(max(entry_no), 0) + 1 into v_next_no
  from public.disbursement_entries
  where request_id = r.id;

  insert into public.disbursement_entries (
    request_id, entry_no, amount, tds_cut, status, notes, created_by, created_by_name,
    entry_type, old_balance
  ) values (
    r.id, v_next_no, v_amt, coalesce(p_tds_cut, false), 'pending_approval',
    nullif(btrim(p_notes), ''), me.id, me.full_name,
    v_entry_type, v_old_bal
  ) returning id into v_entry_id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_created', r.status, r.status,
    'Entry #' || v_next_no || ' (' || upper(v_entry_type) || ') submitted for verification: ₹' || to_char(v_amt, 'FM999999999990.00')
      || case when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
      || case when v_old_bal is not null then ' [Old Bal: ₹' || to_char(v_old_bal, 'FM999999999990.00') || ']' else '' end
      || coalesce(' · ' || nullif(btrim(p_notes), ''), ''),
    true
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'entry_no', v_next_no,
    'amount', v_amt,
    'tds_cut', coalesce(p_tds_cut, false),
    'entry_type', v_entry_type,
    'status', 'pending_approval'
  );
end $$;

grant execute on function public.add_disbursement_entry(uuid, numeric, boolean, text, text, numeric, text) to authenticated;

-- 7. Update pay_disbursement_entry: confirm ONLY linked payment person can pay
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

  if e.status = 'pending_approval' then
    raise exception 'This entry is awaiting Entry Approver approval before it can be paid';
  end if;
  if e.status = 'rejected' then
    raise exception 'This entry was returned for correction and cannot be paid until corrected and approved';
  end if;
  if e.status <> 'approved' and e.status <> 'pending' then
    raise exception 'This entry is not in an approved payable status (current: %)', e.status;
  end if;

  -- Payment Dealer Mode check (cash vs bank)
  if me.role <> 'admin' and me.payment_dealer_type is not null and me.payment_dealer_type <> 'both' then
    if me.payment_dealer_type <> e.entry_type then
      raise exception 'Dealer mismatch: This account is a % dealer, but Entry #% is designated as a % entry',
        upper(me.payment_dealer_type), e.entry_no, upper(e.entry_type);
    end if;
  end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.id is null or r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Request not found';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only approved requests can be paid';
  end if;

  -- ──────────────────────────────────────────────────────────────────────────
  -- Strict Check: ONLY entry account linked payment person gets the chance to pay
  -- ──────────────────────────────────────────────────────────────────────────
  if me.role <> 'admin' then
    -- 1) If this entry account is specifically linked to payment accounts:
    if exists (
      select 1 from public.payment_entry_account_mappings
      where entry_user_id = e.created_by or entry_user_id = r.assigned_entry_user_id
    ) then
      if not exists (
        select 1 from public.payment_entry_account_mappings
        where payment_user_id = me.id
          and (entry_user_id = e.created_by or entry_user_id = r.assigned_entry_user_id)
      ) then
        raise exception 'Routing restriction: Only the payment account specifically linked to this entry account can disburse payment.';
      end if;
    end if;

    -- 2) If this payment account has specific entry accounts assigned to it:
    if exists (
      select 1 from public.payment_entry_account_mappings
      where payment_user_id = me.id
    ) then
      if not exists (
        select 1 from public.payment_entry_account_mappings
        where payment_user_id = me.id
          and (entry_user_id = e.created_by or entry_user_id = r.assigned_entry_user_id)
      ) then
        raise exception 'Routing restriction: This payment account can only pay entries from its assigned entry accounts.';
      end if;
    end if;
  end if;

  v_payable := round(least(e.amount, r.amount - coalesce(r.paid_amount, 0)), 2);
  if v_payable <= 0 then raise exception 'Nothing left to pay on Entry #%', e.entry_no; end if;
  v_amt := round(coalesce(p_amount, v_payable), 2);
  if v_amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  if v_amt > v_payable then
    raise exception 'Payment amount (₹%) cannot exceed the amount of Entry #% (₹%)', v_amt, e.entry_no, v_payable;
  end if;

  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date);

  insert into public.request_payments (
    request_id, amount, payment_date, payment_mode, payment_ref, remarks, paid_by, entry_id
  ) values (
    r.id, v_amt, v_date,
    nullif(btrim(coalesce(p_payment_mode, case when e.entry_type = 'cash' then 'Cash' else 'Bank Transfer' end)), ''),
    nullif(btrim(p_payment_ref), ''),
    nullif(btrim(p_remarks), ''),
    me.id, e.id
  ) returning id into v_payment_id;

  update public.disbursement_entries
  set status = 'paid',
      paid_at = now(),
      paid_by = me.id,
      paid_by_name = me.full_name,
      payment_id = v_payment_id
  where id = e.id;

  select coalesce(sum(amount), 0) into v_paid
  from public.request_payments
  where request_id = r.id;

  v_full := v_paid >= r.amount;

  update public.requests
  set paid_amount = v_paid,
      status = case when v_full then 'paid'::public.request_status else 'approved'::public.request_status end,
      paid_at = case when v_full then now() else paid_at end,
      paid_by = case when v_full then me.id else paid_by end,
      payment_mode = coalesce(nullif(btrim(p_payment_mode), ''), payment_mode),
      payment_ref = coalesce(nullif(btrim(p_payment_ref), ''), payment_ref),
      payment_remarks = coalesce(nullif(btrim(p_remarks), ''), payment_remarks)
  where id = r.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_paid',
    'approved'::public.request_status,
    case when v_full then 'paid'::public.request_status else 'approved'::public.request_status end,
    'Entry #' || e.entry_no || ' disbursed: ₹' || to_char(v_amt, 'FM999999999990.00')
      || ' via ' || coalesce(p_payment_mode, upper(coalesce(e.entry_type, 'bank')))
      || case when p_payment_ref is not null and btrim(p_payment_ref) <> '' then ' (Ref: ' || btrim(p_payment_ref) || ')' else '' end
      || case when v_full then ' [Fully Paid]' else ' [Balance: ₹' || to_char(r.amount - v_paid, 'FM999999999990.00') || ']' end,
    true
  );

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'entry_id', e.id,
    'amount', v_amt,
    'total_paid', v_paid,
    'is_fully_paid', v_full
  );
end $$;

grant execute on function public.pay_disbursement_entry(uuid, numeric, date, text, text, text) to authenticated;

notify pgrst, 'reload schema';
