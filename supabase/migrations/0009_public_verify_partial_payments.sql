-- 0009 — (1) QR verification works without signing in.
--        (2) Partial payments: every payment is a row in request_payments; the request keeps
--            paid_amount and stays 'approved' until fully paid, then becomes 'paid'.

-- ───────────────────────── payments ledger ─────────────────────────────────

alter table public.requests
  add column if not exists paid_amount numeric(14,2) not null default 0;

create table if not exists public.request_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null,
  payment_mode text check (payment_mode is null or char_length(payment_mode) <= 50),
  payment_ref text check (payment_ref is null or char_length(payment_ref) <= 100),
  remarks text check (remarks is null or char_length(remarks) <= 500),
  paid_by uuid references public.profiles(id),
  paid_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists request_payments_request_idx on public.request_payments(request_id, created_at);

alter table public.request_payments enable row level security;
revoke all on public.request_payments from anon;
revoke insert, update, delete, truncate on public.request_payments from authenticated;
grant select on public.request_payments to authenticated;
drop policy if exists request_payments_select on public.request_payments;
create policy request_payments_select on public.request_payments for select to authenticated
  using (public.can_view_request(request_id));

-- requests already marked paid before this change: record one full payment so totals line up
insert into public.request_payments (request_id, amount, payment_date, payment_mode, payment_ref, remarks, paid_by, paid_by_name, created_at)
select r.id, r.amount, coalesce(r.payment_date, (r.paid_at at time zone 'Asia/Kolkata')::date, current_date),
       r.payment_mode, r.payment_ref, r.payment_remarks, r.paid_by, p.full_name, coalesce(r.paid_at, now())
  from public.requests r
  left join public.profiles p on p.id = r.paid_by
 where r.status = 'paid'
   and not exists (select 1 from public.request_payments x where x.request_id = r.id);
update public.requests set paid_amount = amount where status = 'paid' and paid_amount = 0;

-- Disbursement records a payment (full or partial). Fully paid → status 'paid'.
create or replace function public.add_payment(
  p_request_id uuid, p_amount numeric, p_payment_date date default null, p_payment_mode text default null,
  p_payment_ref text default null, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.requests;
  v_amt numeric; v_balance numeric; v_paid numeric; v_date date; v_full boolean;
begin
  me := public._me();
  if me.role is distinct from 'disbursement' then raise exception 'Only Disbursement can record payments'; end if;
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
      coalesce(r.request_no, 'Request') || ' - ₹' || to_char(v_amt, 'FM999999999990.00') || ' paid, balance ₹'
      || to_char(r.amount - v_paid, 'FM999999999990.00'));
  end if;

  return jsonb_build_object('paid_amount', v_paid, 'balance', r.amount - v_paid, 'fully_paid', v_full);
end $$;

-- Old entry point: pays the whole remaining balance
create or replace function public.mark_paid(
  p_request_id uuid, p_payment_date date default null, p_payment_mode text default null,
  p_payment_ref text default null, p_remarks text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.add_payment(p_request_id, null, p_payment_date, p_payment_mode, p_payment_ref, p_remarks);
end $$;

-- ───────────────────────── public verification ─────────────────────────────
-- Anyone with the QR link (the long random token) can verify — no sign-in needed.
-- Looking up by approval number (guessable) is allowed only for signed-in staff.
create or replace function public.verify_approval(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.requests; d public.departments; v_code text := btrim(coalesce(p_token, ''));
begin
  if v_code = '' or char_length(v_code) > 200 then return null; end if;
  select * into r from public.requests
   where status in ('approved','paid')
     and (verify_token = v_code
          or (auth.uid() is not null and (upper(approval_no) = upper(v_code) or upper(request_no) = upper(v_code))))
   limit 1;
  if r.id is null then return null; end if;
  select * into d from public.departments where id = r.department_id;
  return jsonb_build_object(
    'request_id', r.id, 'approval_no', r.approval_no, 'request_no', r.request_no, 'title', r.title,
    'amount', r.amount, 'status', r.status, 'approver_name', r.approver_name, 'approver_role', r.approver_role,
    'decided_at', r.decided_at, 'paid_at', r.paid_at, 'department', d.name, 'requester_name', r.requester_name,
    'request_type', r.request_type, 'shop_name', r.shop_name,
    'paid_amount', r.paid_amount, 'balance', greatest(r.amount - r.paid_amount, 0),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'payment_date', p.payment_date)
                             order by p.payment_date, p.created_at)
                          from public.request_payments p where p.request_id = r.id), '[]'::jsonb),
    'can_open', case when auth.uid() is null then false else public.can_view_request(r.id) end,
    'files', coalesce((select jsonb_agg(jsonb_build_object('file_name', s.file_name, 'sha256', s.sha256,
                'page_count', s.page_count, 'is_packet', s.is_packet) order by s.is_packet desc, s.file_name)
              from public.signed_files s where s.request_id = r.id), '[]'::jsonb));
end $$;

revoke execute on function public.add_payment(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.add_payment(uuid, numeric, date, text, text, text) to authenticated;
revoke execute on function public.mark_paid(uuid, date, text, text, text) from public, anon;
grant execute on function public.mark_paid(uuid, date, text, text, text) to authenticated;
grant execute on function public.verify_approval(text) to anon, authenticated;
