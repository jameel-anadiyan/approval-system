-- ============================================================================
-- 0060_passkeys_tds_amount_partial_approval.sql
--
-- 1. Clerk-raised requests now also require a Disbursement Entry Account at
--    submit time (same rule Department Heads already have).
--
-- 2. Person passkeys on shared Disbursement accounts
--    - One Entry-Only / Payment-Only login can be used by several people.
--    - Admin registers each person (name + 4-digit passkey) on the account.
--    - Creating an entry, resubmitting a rejected entry and paying an entry all
--      need a person's passkey, so every action records WHO did it.
--    - A rejected entry can only be corrected / resubmitted by the SAME person
--      who made it (their passkey).
--
-- 3. TDS amount
--    - When "TDS cut" is ticked the TDS amount must be entered.
--    - TDS is a deduction (like the old-balance adjustment): it is reserved
--      against the request balance as soon as the entry exists and is settled
--      (deducted from the balance) with the entry's first payment.
--      entry amount (paid by cashier) + TDS + adjustment  <=  balance.
--
-- 4. Entry Approver: Full approve / Reject / Partial approve
--    - Partial approve: the approver types the amount the cashier may pay.
--    - The cashier can only pay EXACTLY the approved amount.
--    - After a partial payment the remaining balance returns to the approver
--      queue and must be verified (full / partial) before it can be paid.
--
-- Safe to re-run.
-- ============================================================================

-- ─────────────────────────────── 1. Persons ──────────────────────────────────

create table if not exists public.disbursement_account_persons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles(id) on delete cascade,
  person_name text not null check (char_length(btrim(person_name)) between 1 and 80),
  passkey_hash text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists disbursement_account_persons_account_idx
  on public.disbursement_account_persons(account_id);
-- A passkey identifies a person inside one account, so it must be unique there.
create unique index if not exists disbursement_account_persons_passkey_uidx
  on public.disbursement_account_persons(account_id, passkey_hash) where is_active;
create unique index if not exists disbursement_account_persons_name_uidx
  on public.disbursement_account_persons(account_id, lower(btrim(person_name))) where is_active;

-- The hashes are never readable by clients: RLS on, no policies, no grants.
alter table public.disbursement_account_persons enable row level security;
revoke all on public.disbursement_account_persons from anon, authenticated;

-- ─────────────────────── 2. Entry / payment columns ──────────────────────────

alter table public.disbursement_entries
  add column if not exists tds_amount numeric(14,2) not null default 0,
  add column if not exists tds_settled boolean not null default false,
  add column if not exists approved_amount numeric(14,2),
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists created_by_person_id uuid references public.disbursement_account_persons(id) on delete set null,
  add column if not exists created_by_person_name text,
  add column if not exists paid_by_person_id uuid references public.disbursement_account_persons(id) on delete set null,
  add column if not exists paid_by_person_name text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.disbursement_entries drop constraint if exists disbursement_entries_tds_amount_check;
alter table public.disbursement_entries
  add constraint disbursement_entries_tds_amount_check check (tds_amount >= 0);

alter table public.request_payments
  add column if not exists paid_by_person_name text,
  add column if not exists document_storage_path text,
  add column if not exists document_name text;

-- Safeguard: ensure request_actions.visible_to_requester drops strict not-null, defaults to true and coalesce inside _log_action
alter table public.request_actions alter column visible_to_requester drop not null;
alter table public.request_actions alter column visible_to_requester set default true;

create or replace function public.trg_request_actions_visible_default()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visible_to_requester is null then
    new.visible_to_requester := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_actions_visible_default on public.request_actions;
create trigger trg_request_actions_visible_default
  before insert on public.request_actions
  for each row
  execute function public.trg_request_actions_visible_default();

create or replace function public._log_action(
  p_request_id uuid, p_actor public.profiles, p_action text,
  p_from public.request_status, p_to public.request_status,
  p_remarks text, p_visible boolean default true)
returns void language sql security definer set search_path = '' as $$
  insert into public.request_actions
    (request_id, actor_id, actor_name, actor_role, action, from_status, to_status, remarks, visible_to_requester)
  values (p_request_id, p_actor.id, p_actor.full_name, p_actor.role, p_action, p_from, p_to,
          nullif(btrim(p_remarks), ''), coalesce(p_visible, true))
$$;

-- Storage RLS: allow disbursement accounts (and admins) to upload payment documents
drop policy if exists "request-files payment doc insert" on storage.objects;
create policy "request-files payment doc insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-files'
    and (
      exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.is_active
          and (me.role = 'admin' or me.role = 'disbursement')
      )
      or public.can_view_request(public.storage_request_id(name))
    )
  );

drop policy if exists "request-files payment doc delete" on storage.objects;
create policy "request-files payment doc delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'request-files'
    and (
      exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.is_active
          and (me.role = 'admin' or me.role = 'disbursement')
      )
      or public.can_view_request(public.storage_request_id(name))
    )
  );

drop policy if exists "request-files payment doc read" on storage.objects;
create policy "request-files payment doc read" on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and (
      exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and me.is_active
          and (me.role = 'admin' or me.role = 'disbursement')
      )
      or public.can_view_request(public.storage_request_id(name))
    )
  );

-- Entries paid before this migration were paid in full.
update public.disbursement_entries
   set paid_amount = amount
 where status = 'paid' and paid_amount = 0 and amount > 0;

-- ─────────────────────────── 3. Helper functions ─────────────────────────────

create or replace function public._hash_passkey(p_account_id uuid, p_passkey text)
returns text language sql immutable security definer set search_path = '' as $$
  select encode(sha256(convert_to(p_account_id::text || ':' || coalesce(p_passkey, ''), 'UTF8')), 'hex')
$$;

-- Resolves a typed passkey to the person on that account (raises if wrong).
create or replace function public._verify_account_person(p_account_id uuid, p_passkey text)
returns public.disbursement_account_persons
language plpgsql security definer set search_path = '' as $$
declare
  v public.disbursement_account_persons;
begin
  if p_passkey is null or p_passkey !~ '^[0-9]{4}$' then
    raise exception 'Enter your 4-digit passkey';
  end if;

  select * into v
    from public.disbursement_account_persons
   where account_id = p_account_id
     and is_active
     and passkey_hash = public._hash_passkey(p_account_id, p_passkey);

  if v.id is null then
    if not exists (
      select 1 from public.disbursement_account_persons
       where account_id = p_account_id and is_active
    ) then
      raise exception 'No authorised person / passkey is set up for this account yet. Ask Admin to add the person and passkey.';
    end if;
    raise exception 'Invalid passkey';
  end if;

  return v;
end $$;

-- Balance of a request already earmarked by live (unpaid) entries:
--   cash still to be paid  +  TDS not yet deducted.
create or replace function public._entry_reserved(p_request_id uuid, p_exclude_entry uuid default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(
           greatest(0, e.amount - coalesce(e.paid_amount, 0))
           + case when coalesce(e.tds_settled, false) then 0 else coalesce(e.tds_amount, 0) end
         ), 0)
    from public.disbursement_entries e
   where e.request_id = p_request_id
     and e.status in ('pending', 'pending_approval', 'approved')
     and (p_exclude_entry is null or e.id <> p_exclude_entry)
$$;

revoke execute on function public._hash_passkey(uuid, text) from public, anon, authenticated;
revoke execute on function public._verify_account_person(uuid, text) from public, anon, authenticated;
revoke execute on function public._entry_reserved(uuid, uuid) from public, anon, authenticated;

-- ───────────────────────── 4. Person management (Admin) ──────────────────────

create or replace function public.add_disbursement_person(
  p_account_id uuid,
  p_name text,
  p_passkey text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  acc public.profiles;
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can add persons / passkeys to a disbursement account'; end if;

  select * into acc from public.profiles where id = p_account_id;
  if acc.id is null or acc.role <> 'disbursement' then
    raise exception 'Persons can only be added to Disbursement accounts';
  end if;
  if v_name = '' then raise exception 'Enter the person''s name'; end if;
  if p_passkey is null or p_passkey !~ '^[0-9]{4}$' then raise exception 'Passkey must be exactly 4 digits'; end if;

  if exists (
    select 1 from public.disbursement_account_persons
     where account_id = acc.id and is_active and lower(btrim(person_name)) = lower(v_name)
  ) then
    raise exception '% is already added on this account', v_name;
  end if;
  if exists (
    select 1 from public.disbursement_account_persons
     where account_id = acc.id and is_active and passkey_hash = public._hash_passkey(acc.id, p_passkey)
  ) then
    raise exception 'This passkey is already used by another person on this account. Choose a different 4-digit passkey';
  end if;

  insert into public.disbursement_account_persons (account_id, person_name, passkey_hash, created_by)
  values (acc.id, v_name, public._hash_passkey(acc.id, p_passkey), me.id)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'person_name', v_name);
end $$;

create or replace function public.update_disbursement_person(
  p_person_id uuid,
  p_name text default null,
  p_passkey text default null,
  p_is_active boolean default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  p public.disbursement_account_persons;
  v_name text;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can change persons / passkeys'; end if;

  select * into p from public.disbursement_account_persons where id = p_person_id for update;
  if p.id is null then raise exception 'Person not found'; end if;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), p.person_name);

  if p_passkey is not null then
    if p_passkey !~ '^[0-9]{4}$' then raise exception 'Passkey must be exactly 4 digits'; end if;
    if exists (
      select 1 from public.disbursement_account_persons
       where account_id = p.account_id and is_active and id <> p.id
         and passkey_hash = public._hash_passkey(p.account_id, p_passkey)
    ) then
      raise exception 'This passkey is already used by another person on this account. Choose a different 4-digit passkey';
    end if;
  end if;

  if coalesce(p_is_active, p.is_active) and exists (
    select 1 from public.disbursement_account_persons
     where account_id = p.account_id and is_active and id <> p.id
       and lower(btrim(person_name)) = lower(v_name)
  ) then
    raise exception '% is already added on this account', v_name;
  end if;

  update public.disbursement_account_persons set
    person_name = v_name,
    passkey_hash = case when p_passkey is not null then public._hash_passkey(p.account_id, p_passkey) else passkey_hash end,
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p.id;

  return jsonb_build_object('success', true, 'id', p.id);
end $$;

create or replace function public.list_disbursement_persons(p_account_id uuid default null)
returns table (
  id uuid,
  account_id uuid,
  person_name text,
  is_active boolean,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can view persons / passkeys'; end if;
  return query
    select p.id, p.account_id, p.person_name, p.is_active, p.created_at
      from public.disbursement_account_persons p
     where p_account_id is null or p.account_id = p_account_id
     order by p.created_at;
end $$;

-- Lets an Entry / Payment account know whether any person has been set up
-- (so the screen can warn before asking for a passkey that cannot exist).
create or replace function public.my_disbursement_person_count()
returns int language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  me := public._me();
  return (select count(*)::int from public.disbursement_account_persons where account_id = me.id and is_active);
end $$;

revoke execute on function public.add_disbursement_person(uuid, text, text) from public, anon;
revoke execute on function public.update_disbursement_person(uuid, text, text, boolean) from public, anon;
revoke execute on function public.list_disbursement_persons(uuid) from public, anon;
revoke execute on function public.my_disbursement_person_count() from public, anon;
grant execute on function public.add_disbursement_person(uuid, text, text) to authenticated;
grant execute on function public.update_disbursement_person(uuid, text, text, boolean) to authenticated;
grant execute on function public.list_disbursement_persons(uuid) to authenticated;
grant execute on function public.my_disbursement_person_count() to authenticated;

-- ────────────────── 5. Drop every older overload of the entry RPCs ───────────
-- (0042 / 0050 / 0051 / 0056 / 0059 left several signatures behind, which makes
--  named-argument calls ambiguous.)

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'add_disbursement_entry',
         'edit_rejected_disbursement_entry',
         'approve_disbursement_entry',
         'pay_disbursement_entry',
         'cancel_disbursement_entry'
       )
  loop
    execute 'drop function ' || f.sig;
  end loop;
end $$;

-- ───────────────────────────── 6. add_disbursement_entry ─────────────────────

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

  -- Who is making this entry? (Admin acts under their own login.)
  if me.role <> 'admin' then
    person := public._verify_account_person(me.id, p_passkey);
  end if;
  v_by := coalesce(person.person_name, me.full_name);

  if v_type not in ('cash', 'bank') then
    raise exception 'Entry type must be either cash or bank';
  end if;

  -- Concurrent session lock (same login open on another computer)
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

  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);
  v_tds := case when coalesce(p_tds_cut, false) then round(coalesce(p_tds_amount, 0), 2) else 0 end;
  if v_amt < 0 then raise exception 'Entry amount cannot be negative'; end if;
  if v_adj < 0 then raise exception 'Old balance / advance adjustment cannot be negative'; end if;
  if coalesce(p_tds_cut, false) and v_tds <= 0 then
    raise exception 'TDS is marked as cut - enter the TDS amount';
  end if;
  if v_amt + v_adj <= 0 then raise exception 'Enter an entry amount or an old balance / advance adjustment'; end if;
  v_adjust_only := v_amt = 0;
  if v_adjust_only and v_tds > 0 then
    raise exception 'TDS needs an entry amount to be paid';
  end if;

  v_available := round(r.amount - coalesce(r.paid_amount, 0) - public._entry_reserved(r.id), 2);
  if v_amt + v_adj + v_tds > v_available then
    raise exception 'Entry ₹% + TDS ₹% + adjustment ₹% is more than the balance available for entries (₹%)',
      v_amt, v_tds, v_adj, greatest(v_available, 0);
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_next_no
    from public.disbursement_entries where request_id = r.id;

  insert into public.disbursement_entries (
    request_id, entry_no, amount, adjustment_amount, tds_cut, tds_amount, status, notes, entry_type,
    created_by, created_by_name, created_by_person_id, created_by_person_name,
    paid_amount
  ) values (
    r.id, v_next_no, v_amt, v_adj, coalesce(p_tds_cut, false), v_tds,
    case when v_adjust_only then 'paid' else 'pending_approval' end,
    v_notes, v_type, me.id, me.full_name, person.id, person.person_name,
    0
  ) returning id into v_entry_id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_created', r.status, r.status,
    'Entry #' || v_next_no || ' (' || upper(v_type) || ') made by ' || v_by
      || ': ₹' || to_char(v_amt, 'FM999999999990.00') || ' to pay'
      || case when v_tds > 0 then ' · TDS cut ₹' || to_char(v_tds, 'FM999999999990.00')
              when coalesce(p_tds_cut, false) then ' (TDS Cut)' else ' (TDS Not Cut)' end
      || case when v_adj > 0
              then ' · Old balance / advance adjusted ₹' || to_char(v_adj, 'FM999999999990.00')
              else '' end
      || case when v_adjust_only then '' else ' (Pending Approver sign-off)' end
      || coalesce(' · ' || v_notes, ''),
    true
  );

  -- Old balance / advance adjustment is settled straight away
  if v_adj > 0 then
    insert into public.request_payments (
      request_id, amount, payment_date, payment_mode, payment_ref, remarks,
      paid_by, paid_by_name, paid_by_person_name, entry_id, is_adjustment
    ) values (
      r.id, v_adj, v_today, 'Adjustment', null,
      left('Old balance / old advance adjustment · Entry #' || v_next_no || coalesce(' · ' || v_notes, ''), 500),
      me.id, me.full_name, person.person_name, v_entry_id, true
    ) returning id into v_payment_id;

    update public.disbursement_entries set
      adjustment_payment_id = v_payment_id,
      paid_at = case when v_adjust_only then now() else paid_at end,
      paid_by = case when v_adjust_only then me.id else paid_by end,
      paid_by_name = case when v_adjust_only then me.full_name else paid_by_name end,
      paid_by_person_id = case when v_adjust_only then person.id else paid_by_person_id end,
      paid_by_person_name = case when v_adjust_only then person.person_name else paid_by_person_name end,
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

  -- Tell the Entry Approvers there is something to verify
  if not v_adjust_only then
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
    'tds_cut', coalesce(p_tds_cut, false),
    'tds_amount', v_tds,
    'status', case when v_adjust_only then 'paid' else 'pending_approval' end,
    'fully_paid', v_full
  );
end $$;

revoke execute on function public.add_disbursement_entry(uuid, numeric, boolean, text, numeric, text, text, numeric, text) from public, anon;
grant execute on function public.add_disbursement_entry(uuid, numeric, boolean, text, numeric, text, text, numeric, text) to authenticated;

-- ────────────────────── 7. edit_rejected_disbursement_entry ──────────────────
-- Only the SAME person who made the entry (their passkey) can resubmit it.

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
  if v_type not in ('cash', 'bank') then
    raise exception 'Entry mode must be either cash or bank';
  end if;

  v_amt := round(coalesce(p_amount, 0), 2);
  v_adj := round(coalesce(p_adjustment, 0), 2);
  v_old_adj := coalesce(e.adjustment_amount, 0);
  v_tds := case when coalesce(p_tds_cut, false) then round(coalesce(p_tds_amount, 0), 2) else 0 end;
  if v_amt <= 0 then raise exception 'Entry amount must be more than zero'; end if;
  if v_adj < 0 then raise exception 'Adjustment amount cannot be negative'; end if;
  if coalesce(p_tds_cut, false) and v_tds <= 0 then
    raise exception 'TDS is marked as cut - enter the TDS amount';
  end if;

  -- paid_amount of the request already contains this entry's old adjustment
  v_available := round(
    r.amount - coalesce(r.paid_amount, 0) + v_old_adj - public._entry_reserved(r.id, e.id), 2);
  if v_amt + v_adj + v_tds > v_available then
    raise exception 'Corrected amount ₹% (entry + TDS + adjustment) exceeds balance available (₹%)',
      v_amt + v_adj + v_tds, greatest(v_available, 0);
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
        r.id, v_adj, v_today, 'Adjustment', null,
        left('Old balance / old advance adjustment · Entry #' || e.entry_no || coalesce(' · ' || v_notes, ''), 500),
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

  update public.disbursement_entries set
    amount = v_amt,
    entry_type = v_type,
    tds_cut = coalesce(p_tds_cut, false),
    tds_amount = v_tds,
    tds_settled = false,
    approved_amount = null,
    notes = v_notes,
    adjustment_amount = v_adj,
    adjustment_payment_id = v_payment_id,
    created_by_person_id = coalesce(e.created_by_person_id, person.id),
    created_by_person_name = coalesce(e.created_by_person_name, person.person_name),
    status = 'pending_approval',
    rejection_reason = null,
    rejected_by = null,
    rejected_by_name = null,
    rejected_at = null,
    updated_at = now()
  where id = e.id;

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

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', v_amt,
    'entry_type', v_type,
    'tds_amount', v_tds,
    'status', 'pending_approval'
  );
end $$;

revoke execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric, numeric, text) from public, anon;
grant execute on function public.edit_rejected_disbursement_entry(uuid, numeric, text, boolean, text, numeric, numeric, text) to authenticated;

-- ───────────────────── 8. approve (full / partial) & reject ──────────────────

create or replace function public.approve_disbursement_entry(
  p_entry_id uuid,
  p_remarks text default null,
  p_approved_amount numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_outstanding numeric;
  v_approve numeric;
  v_partial boolean;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_approver') then
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can approve disbursement entries';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending_approval' and e.status <> 'pending' then
    raise exception 'This entry is not waiting for approver review (current status: %)', e.status;
  end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.status <> 'approved' then raise exception 'Request is no longer waiting for payment'; end if;

  v_outstanding := round(e.amount - coalesce(e.paid_amount, 0), 2);
  if v_outstanding <= 0 then raise exception 'Nothing left to approve on Entry #%', e.entry_no; end if;

  v_approve := round(coalesce(p_approved_amount, v_outstanding), 2);
  if v_approve <= 0 then raise exception 'Approved amount must be more than zero'; end if;
  if v_approve > v_outstanding then
    raise exception 'Approved amount (₹%) cannot be more than the entry balance (₹%)', v_approve, v_outstanding;
  end if;
  v_partial := v_approve < v_outstanding;

  update public.disbursement_entries set
    status = 'approved',
    approved_amount = v_approve,
    approved_at = now(),
    approved_by = me.id,
    approved_by_name = me.full_name,
    rejected_at = null,
    rejected_by = null,
    rejected_by_name = null,
    rejection_reason = null,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_approved', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ') '
      || case when v_partial
              then 'PARTIALLY approved by ' || me.full_name || ': ₹' || to_char(v_approve, 'FM999999999990.00')
                   || ' of ₹' || to_char(v_outstanding, 'FM999999999990.00')
                   || ' · balance ₹' || to_char(v_outstanding - v_approve, 'FM999999999990.00') || ' needs verification again'
              else 'fully approved by ' || me.full_name || ': ₹' || to_char(v_approve, 'FM999999999990.00') end
      || ' · Routed to ' || upper(e.entry_type) || ' payment account'
      || coalesce(' · ' || nullif(btrim(p_remarks), ''), ''),
    true
  );

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'entry_no', e.entry_no,
    'amount', e.amount,
    'approved_amount', v_approve,
    'partial', v_partial,
    'entry_type', e.entry_type,
    'status', 'approved'
  );
end $$;

revoke execute on function public.approve_disbursement_entry(uuid, text, numeric) from public, anon;
grant execute on function public.approve_disbursement_entry(uuid, text, numeric) to authenticated;

create or replace function public.approve_multiple_disbursement_entries(
  p_entry_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count int := 0;
  v_failed int := 0;
begin
  if p_entry_ids is null or array_length(p_entry_ids, 1) = 0 then
    raise exception 'No entries provided for approval';
  end if;

  foreach v_id in array p_entry_ids loop
    begin
      -- bulk approval is always a FULL approval of the entry balance
      perform public.approve_disbursement_entry(v_id, 'Bulk approved', null);
      v_count := v_count + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('success', true, 'approved_count', v_count, 'failed_count', v_failed);
end $$;

revoke execute on function public.approve_multiple_disbursement_entries(uuid[]) from public, anon;
grant execute on function public.approve_multiple_disbursement_entries(uuid[]) to authenticated;

create or replace function public.reject_disbursement_entry(
  p_entry_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_reason text := nullif(btrim(p_reason), '');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_approver') then
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can reject disbursement entries';
  end if;

  if v_reason is null then
    raise exception 'Please specify the rejection / correction reason';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending_approval' and e.status <> 'pending' then
    raise exception 'This entry is not waiting for approver review (current status: %)', e.status;
  end if;
  if coalesce(e.paid_amount, 0) > 0 then
    raise exception 'Entry #% is already partly paid (₹%). Approve the balance in full or partially instead of rejecting it.',
      e.entry_no, e.paid_amount;
  end if;

  select * into r from public.requests where id = e.request_id for update;

  update public.disbursement_entries set
    status = 'rejected',
    approved_amount = null,
    rejected_at = now(),
    rejected_by = me.id,
    rejected_by_name = me.full_name,
    rejection_reason = v_reason,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_rejected', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ' · ₹' || to_char(e.amount, 'FM999999999990.00')
      || ') returned for correction by ' || me.full_name || ': ' || v_reason
      || coalesce(' · Made by ' || e.created_by_person_name, ''),
    true
  );

  if e.created_by is not null then
    perform public._notify(
      array[e.created_by], r.id, 'Entry #' || e.entry_no || ' returned for correction',
      coalesce(r.request_no, 'Request') || ': ' || v_reason
        || coalesce(' (to be corrected by ' || e.created_by_person_name || ')', '')
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'entry_id', e.id,
    'status', 'rejected',
    'rejection_reason', v_reason
  );
end $$;

revoke execute on function public.reject_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.reject_disbursement_entry(uuid, text) to authenticated;

-- ───────────────────────── 9. cancel_disbursement_entry ──────────────────────

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
  if coalesce(e.paid_amount, 0) > 0 then raise exception 'Cannot cancel an entry that has already been partly paid'; end if;

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

-- ───────────────────────────── 10. pay_disbursement_entry ────────────────────
-- The cashier can only pay the EXACT amount the approver approved (the full
-- entry amount, or the partial figure the approver typed).

-- Drop previous overloaded signatures to avoid PostgREST ambiguity
drop function if exists public.pay_disbursement_entry(uuid, numeric, date, text, text, text);
drop function if exists public.pay_disbursement_entry(uuid, numeric, date, text, text, text, text);
drop function if exists public.pay_disbursement_entry(uuid, numeric, date, text, text, text, text, text, text);

create or replace function public.pay_disbursement_entry(
  p_entry_id uuid,
  p_amount numeric default null,
  p_payment_date date default null,
  p_payment_mode text default null,
  p_payment_ref text default null,
  p_remarks text default null,
  p_passkey text default null,
  p_document_storage_path text default null,
  p_document_name text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  person public.disbursement_account_persons;
  e public.disbursement_entries;
  r public.requests;
  v_amt numeric;
  v_approved numeric;
  v_date date;
  v_payment_id uuid;
  v_paid numeric;
  v_full boolean;
  v_entry_paid numeric;
  v_entry_left numeric;
  v_tds_settle numeric := 0;
  v_by text;
  v_clean_mode text;
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, 'entry_only') <> 'payment_only') then
    raise exception 'Permission denied: Only Payment-Only or Admin accounts can disburse payments';
  end if;

  if me.role <> 'admin' then
    person := public._verify_account_person(me.id, p_passkey);
  end if;
  v_by := coalesce(person.person_name, me.full_name);

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

  -- Payment Dealer Mode check (account restriction)
  if me.role <> 'admin' and me.payment_dealer_type is not null and me.payment_dealer_type <> 'both' then
    if me.payment_dealer_type <> e.entry_type then
      raise exception 'Dealer mismatch: This account is a % dealer, but Entry #% is designated as a % entry',
        upper(me.payment_dealer_type), e.entry_no, upper(e.entry_type);
    end if;
  end if;

  -- Strict Entry Mode check:
  -- If entry is cash: mode MUST be Cash.
  -- If entry is bank: mode CANNOT be Cash.
  v_clean_mode := btrim(coalesce(p_payment_mode, case when e.entry_type = 'cash' then 'Cash' else 'Bank Transfer' end));
  if e.entry_type = 'cash' and lower(v_clean_mode) <> 'cash' then
    raise exception 'This entry is defined as Cash payment. Bank modes are not allowed.';
  end if;
  if e.entry_type = 'bank' and lower(v_clean_mode) = 'cash' then
    raise exception 'This entry is defined as Bank transfer. Cash mode is not allowed.';
  end if;

  select * into r from public.requests where id = e.request_id for update;
  if r.id is null or r.request_type in ('discount', 'non_cash', 'stock_transfer') then
    raise exception 'Request not found';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only approved requests can be paid';
  end if;

  -- Only the payment account linked to the entry account may pay
  if me.role <> 'admin' then
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

    if exists (select 1 from public.payment_entry_account_mappings where payment_user_id = me.id) then
      if not exists (
        select 1 from public.payment_entry_account_mappings
         where payment_user_id = me.id
           and (entry_user_id = e.created_by or entry_user_id = r.assigned_entry_user_id)
      ) then
        raise exception 'Routing restriction: This payment account can only pay entries from its assigned entry accounts.';
      end if;
    end if;
  end if;

  -- Exact approved amount only
  v_approved := round(coalesce(e.approved_amount, e.amount - coalesce(e.paid_amount, 0)), 2);
  if v_approved <= 0 then raise exception 'Nothing left to pay on Entry #%', e.entry_no; end if;
  if p_amount is not null and round(p_amount, 2) <> v_approved then
    raise exception 'You can only pay the exact approved amount of ₹% for Entry #% (you entered ₹%)',
      to_char(v_approved, 'FM999999999990.00'), e.entry_no, to_char(round(p_amount, 2), 'FM999999999990.00');
  end if;
  v_amt := v_approved;

  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date);
  if v_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Payment date cannot be in the future';
  end if;

  -- TDS is deducted from the request balance with the entry's first payment
  if coalesce(e.tds_amount, 0) > 0 and not coalesce(e.tds_settled, false) then
    v_tds_settle := e.tds_amount;
    insert into public.request_payments (
      request_id, amount, payment_date, payment_mode, payment_ref, remarks,
      paid_by, paid_by_name, paid_by_person_name, entry_id, is_adjustment
    ) values (
      r.id, v_tds_settle, v_date, 'TDS', null,
      left('TDS deducted · Entry #' || e.entry_no, 500),
      me.id, me.full_name, v_by, e.id, true
    );
  end if;

  insert into public.request_payments (
    request_id, amount, payment_date, payment_mode, payment_ref, remarks,
    paid_by, paid_by_name, paid_by_person_name, entry_id,
    document_storage_path, document_name
  ) values (
    r.id, v_amt, v_date,
    nullif(v_clean_mode, ''),
    nullif(btrim(p_payment_ref), ''),
    nullif(btrim(p_remarks), ''),
    me.id, me.full_name, v_by, e.id,
    nullif(btrim(p_document_storage_path), ''),
    nullif(btrim(p_document_name), '')
  ) returning id into v_payment_id;

  v_entry_paid := round(coalesce(e.paid_amount, 0) + v_amt, 2);
  v_entry_left := round(e.amount - v_entry_paid, 2);

  update public.disbursement_entries set
    paid_amount = v_entry_paid,
    approved_amount = null,
    tds_settled = tds_settled or v_tds_settle > 0,
    paid_at = now(),
    paid_by = me.id,
    paid_by_name = me.full_name,
    paid_by_person_id = person.id,
    paid_by_person_name = person.person_name,
    payment_id = v_payment_id,
    -- fully paid -> 'paid'; part-paid -> back to the approver to verify the balance
    status = case when v_entry_left <= 0 then 'paid' else 'pending_approval' end,
    updated_at = now()
  where id = e.id;

  select coalesce(sum(amount), 0) into v_paid
    from public.request_payments where request_id = r.id;

  v_full := v_paid >= r.amount;

  update public.requests set
    paid_amount = v_paid,
    status = case when v_full then 'paid'::public.request_status else 'approved'::public.request_status end,
    paid_at = case when v_full then now() else paid_at end,
    paid_by = case when v_full then me.id else paid_by end,
    payment_date = case when v_full then v_date else payment_date end,
    payment_mode = coalesce(nullif(v_clean_mode, ''), payment_mode),
    payment_ref = coalesce(nullif(btrim(p_payment_ref), ''), payment_ref),
    payment_remarks = coalesce(nullif(btrim(p_remarks), ''), payment_remarks),
    updated_at = now()
  where id = r.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_paid',
    'approved'::public.request_status,
    case when v_full then 'paid'::public.request_status else 'approved'::public.request_status end,
    'Entry #' || e.entry_no || ' disbursed by ' || v_by || ': ₹' || to_char(v_amt, 'FM999999999990.00')
      || ' via ' || coalesce(v_clean_mode, upper(coalesce(e.entry_type, 'bank')))
      || case when v_tds_settle > 0 then ' · TDS ₹' || to_char(v_tds_settle, 'FM999999999990.00') || ' deducted from balance' else '' end
      || case when p_payment_ref is not null and btrim(p_payment_ref) <> '' then ' (Ref: ' || btrim(p_payment_ref) || ')' else '' end
      || case when nullif(btrim(p_document_name), '') is not null then ' (doc attached: ' || p_document_name || ')' else '' end
      || case when v_entry_left > 0 then ' · Entry balance ₹' || to_char(v_entry_left, 'FM999999999990.00') || ' sent back for verification' else '' end
      || case when v_full then ' [Fully Paid]' else ' [Request balance: ₹' || to_char(r.amount - v_paid, 'FM999999999990.00') || ']' end,
    true
  );

  if v_full then
    perform public.notify_next_actor(r.id, 'paid');
  elsif v_entry_left > 0 then
    perform public._notify(
      (select array_agg(id) from public.profiles
        where is_active and (role = 'admin' or (role = 'disbursement' and disbursement_type = 'entry_approver'))),
      r.id,
      'Entry #' || e.entry_no || ' balance needs verification',
      coalesce(r.request_no, 'Request') || ': ₹' || to_char(v_amt, 'FM999999999990.00') || ' paid, balance ₹'
        || to_char(v_entry_left, 'FM999999999990.00') || ' awaiting your verification'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'entry_id', e.id,
    'paid_amount', v_amt,
    'entry_paid_total', v_entry_paid,
    'entry_balance', v_entry_left,
    'request_paid_total', v_paid,
    'request_balance', greatest(0, r.amount - v_paid),
    'fully_paid', v_full,
    'tds_settled', v_tds_settle,
    'disbursed_by', v_by
  );
end $$;

revoke execute on function public.pay_disbursement_entry(uuid, numeric, date, text, text, text, text, text, text) from public, anon;
grant execute on function public.pay_disbursement_entry(uuid, numeric, date, text, text, text, text, text, text) to authenticated;

-- ──────────────────── 11. submit_request: clerks pick the entry account too ──
-- Same body as 0054; the only change is that the Disbursement Entry Account is
-- also mandatory when a CLERK raises a disbursement-needed request.

drop function if exists public.submit_request(uuid);

create or replace function public.submit_request(
  p_request_id uuid,
  p_entry_user_id uuid default null
)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  me public.profiles;
  r public.requests;
  rh public.profiles;
  v_no text;
  n int;
  v_rh_count int;
  v_next public.request_status;
  v_cat_ok boolean;
  target_entry_user public.profiles;
begin
  me := public._me();
  select * into r from public.requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> me.id then raise exception 'Not found'; end if;
  if r.status not in ('draft','returned') then raise exception 'This request cannot be submitted'; end if;

  if r.shop_id is null and me.shop_id is null and me.role = 'employee' then
    raise exception 'Your shop is not assigned yet. Contact your Department Head before submitting';
  end if;

  if r.request_type <> 'non_cash' and (r.amount is null or r.amount <= 0) then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_entry_user_id is not null then
    select * into target_entry_user from public.profiles where id = p_entry_user_id and is_active;
    if target_entry_user.id is null then
      raise exception 'Target disbursement entry account not found or inactive';
    end if;
    if target_entry_user.role <> 'disbursement'
       or target_entry_user.disbursement_type is distinct from 'entry_only'
       or (lower(coalesce(target_entry_user.designation, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.username, '')) ~ '(approv|check|verif|review|audit)')
       or (lower(coalesce(target_entry_user.full_name, '')) ~ '(approv|check|verif|review|audit)') then
      raise exception 'Selected user must be an active Disbursement Entry Only account';
    end if;

    update public.requests set
      assigned_entry_user_id = target_entry_user.id,
      assigned_entry_user_name = target_entry_user.full_name,
      assigned_entry_at = now(),
      assigned_entry_by = me.id
    where id = r.id;

    r.assigned_entry_user_id := target_entry_user.id;
    r.assigned_entry_user_name := target_entry_user.full_name;
  end if;

  -- Department Head AND Clerk requests that need disbursement must name the Entry account at submit.
  if me.role in ('head', 'clerk') and r.request_type not in ('discount', 'non_cash', 'stock_transfer') then
    if r.assigned_entry_user_id is null then
      raise exception 'Please select a Disbursement Entry Account before submitting this request';
    end if;
  end if;

  v_cat_ok := r.category_id is not null and exists (
    select 1 from public.work_categories c
     where c.id = r.category_id and c.department_id = r.department_id and c.is_active);
  if me.role not in ('head', 'clerk') and public._category_required(r.department_id) then
    if r.category_id is null then raise exception 'Select the work category for this request'; end if;
    if not v_cat_ok then raise exception 'The selected work category is no longer available. Pick another one'; end if;
  elsif r.category_id is not null and not v_cat_ok then
    update public.requests set category_id = null, category_name = null where id = r.id;
    r.category_id := null;
  end if;

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

  if r.request_type = 'asset_below_20k' then
    if r.amount > 20000 then raise exception 'Amount cannot exceed ₹20,000 for Asset Buying Below 20k'; end if;
    select count(*) into n from public.request_files
     where request_id = r.id and kind = 'document' and added_by is null
       and quote_amount is not null and nullif(btrim(coalesce(quote_vendor, '')), '') is not null;
    if n < 1 then raise exception 'Attach at least 1 bill or quotation with vendor name and amount (% so far)', n; end if;
    update public.request_files set quote_status = 'pending' where request_id = r.id and quote_amount is not null;
    update public.requests set selected_quote_id = null, quote_selected_by = null, quote_selected_by_name = null,
      quote_selected_at = null where id = r.id;
    perform public._sync_asset_amount(r.id);
  end if;

  if me.role = 'head' then
    v_next := 'pending_admin_approval';
  elsif me.role = 'clerk' then
    -- Clerk requests go directly to Department Head!
    if r.request_type = 'exhibition' or r.amount > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'threshold_amount'), 10000) then
      v_next := 'pending_head_review';
    else
      v_next := 'pending_head_approval';
    end if;
  elsif me.role = 'employee' then
    if me.regional_head_id is not null then
      select p.* into rh from public.profiles p
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
  elsif me.role = 'clerk' then
    update public.requests set
      status = v_next,
      request_no = v_no,
      route = case when v_next = 'pending_head_review' then 'A' else 'B' end,
      routed_by = me.id,
      routed_at = now(),
      reviewed_by = null,
      reviewed_by_name = null,
      reviewed_at = null,
      regional_head_id = null,
      regional_head_name = null,
      regional_forwarded_at = null,
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where id = r.id;

    perform public._log_action(r.id, me, 'submitted', r.status, v_next,
      'Clerk request routed directly to Department Head for review and approval', true);
    perform public.notify_next_actor(r.id, v_next);
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

revoke execute on function public.submit_request(uuid, uuid) from public, anon;
grant execute on function public.submit_request(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
