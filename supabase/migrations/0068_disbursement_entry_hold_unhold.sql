-- Migration 0068: Add hold & unhold functionality for Treasury Gatekeeper Disbursement Entry Approvals
-- Allows entry approver to place pending entries on hold with a mandatory reason note,
-- separating them into a dedicated 'On Hold' list, and later unhold them back to pending.

-- 1. Expand disbursement_entries status constraint to include 'on_hold' ------------
alter table public.disbursement_entries drop constraint if exists disbursement_entries_status_check;
alter table public.disbursement_entries
  add constraint disbursement_entries_status_check
  check (status in ('pending', 'pending_approval', 'approved', 'rejected', 'paid', 'cancelled', 'on_hold'));

-- 2. Add tracking columns for hold status -----------------------------------------
alter table public.disbursement_entries
  add column if not exists held_by uuid references public.profiles(id) on delete set null,
  add column if not exists held_by_name text,
  add column if not exists held_at timestamptz,
  add column if not exists hold_reason text check (hold_reason is null or char_length(hold_reason) <= 1000);

-- 3. Grant column updates to authenticated users -----------------------------------
grant update (status, held_by, held_by_name, held_at, hold_reason, updated_at) on public.disbursement_entries to authenticated;

-- 4. RPC: hold_disbursement_entry -------------------------------------------------
create or replace function public.hold_disbursement_entry(
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
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can hold disbursement entries';
  end if;

  if v_reason is null then
    raise exception 'Please specify a reason for placing this entry on hold';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'pending_approval' and e.status <> 'pending' then
    raise exception 'This entry is not waiting for approver review (current status: %)', e.status;
  end if;

  select * into r from public.requests where id = e.request_id for update;

  update public.disbursement_entries set
    status = 'on_hold',
    held_at = now(),
    held_by = me.id,
    held_by_name = me.full_name,
    hold_reason = v_reason,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_held', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ' · ₹' || to_char(e.amount, 'FM999999999990.00')
      || ') placed ON HOLD by ' || me.full_name || ': ' || v_reason,
    true
  );

  return jsonb_build_object('success', true, 'entry_no', e.entry_no);
end $$;

revoke execute on function public.hold_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.hold_disbursement_entry(uuid, text) to authenticated;

-- 5. RPC: unhold_disbursement_entry -----------------------------------------------
create or replace function public.unhold_disbursement_entry(
  p_entry_id uuid,
  p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  e public.disbursement_entries;
  r public.requests;
  v_notes text := nullif(btrim(p_notes), '');
begin
  me := public._me();
  if me.role <> 'admin' and (me.role <> 'disbursement' or coalesce(me.disbursement_type, '') <> 'entry_approver') then
    raise exception 'Permission denied: Only Entry Approver accounts or Admin can unhold disbursement entries';
  end if;

  select * into e from public.disbursement_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Entry not found'; end if;
  if e.status <> 'on_hold' then
    raise exception 'This entry is not on hold (current status: %)', e.status;
  end if;

  select * into r from public.requests where id = e.request_id for update;

  update public.disbursement_entries set
    status = 'pending_approval',
    held_at = null,
    held_by = null,
    held_by_name = null,
    hold_reason = null,
    updated_at = now()
  where id = e.id;

  perform public._log_action(
    r.id, me, 'disbursement_entry_unheld', r.status, r.status,
    'Entry #' || e.entry_no || ' (' || upper(e.entry_type) || ' · ₹' || to_char(e.amount, 'FM999999999990.00')
      || ') taken OFF HOLD and returned to Pending by ' || me.full_name || coalesce(' - Note: ' || v_notes, ''),
    true
  );

  return jsonb_build_object('success', true, 'entry_no', e.entry_no);
end $$;

revoke execute on function public.unhold_disbursement_entry(uuid, text) from public, anon;
grant execute on function public.unhold_disbursement_entry(uuid, text) to authenticated;

notify pgrst, 'reload schema';
