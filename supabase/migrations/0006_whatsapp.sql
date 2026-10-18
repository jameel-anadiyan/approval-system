-- 0006 — WhatsApp alerts (Twilio) for every workflow step.
-- Every notifications row with whatsapp = true is pushed (via pg_net) to the
-- whatsapp-notify Edge Function, which sends it to the recipient's phone.

create extension if not exists pg_net;

-- phone numbers (E.164, e.g. +919876543210) ------------------------------------
alter table public.profiles add column if not exists phone text;
alter table public.profiles drop constraint if exists profiles_phone_format;
alter table public.profiles add constraint profiles_phone_format
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

-- delivery tracking on notifications -------------------------------------------
alter table public.notifications add column if not exists whatsapp boolean not null default true;
alter table public.notifications add column if not exists wa_status text;
alter table public.notifications add column if not exists wa_error text;
alter table public.notifications add column if not exists wa_sent_at timestamptz;

-- hook config: server-only (RLS on, no policies, no grants) ----------------------
create table if not exists public.whatsapp_hook (
  id int primary key default 1 check (id = 1),
  hook_url text,
  hook_secret text not null
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  enabled boolean not null default true
);
alter table public.whatsapp_hook enable row level security;
revoke all on public.whatsapp_hook from anon, authenticated;
insert into public.whatsapp_hook (id) values (1) on conflict (id) do nothing;

-- set_phone: self, Admin (anyone), Head (own department clerks/employees) -------
create or replace function public.set_phone(p_user_id uuid, p_phone text)
returns text language plpgsql security definer set search_path = '' as $$
declare me public.profiles; t public.profiles; v text;
begin
  me := public._me();
  select * into t from public.profiles where id = p_user_id;
  if t.id is null then raise exception 'User not found'; end if;
  if not (me.id = t.id or me.role = 'admin'
          or (me.role = 'head' and t.department_id = me.department_id and t.role in ('clerk','employee'))) then
    raise exception 'You cannot change this phone number' using errcode = '42501';
  end if;
  v := nullif(regexp_replace(coalesce(p_phone, ''), '[\s\-().]', '', 'g'), '');
  if v is not null and v ~ '^[6-9][0-9]{9}$' then v := '+91' || v; end if;   -- bare Indian mobile
  if v is not null and v ~ '^91[6-9][0-9]{9}$' then v := '+' || v; end if;
  if v is not null and v !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Phone must be in international format, e.g. +919876543210';
  end if;
  update public.profiles set phone = v, updated_at = now() where id = t.id;
  return v;
end $$;
revoke execute on function public.set_phone(uuid, text) from public, anon;
grant execute on function public.set_phone(uuid, text) to authenticated;

-- _notify_ex: like _notify but lets the caller turn WhatsApp off ---------------
create or replace function public._notify_ex(p_user_ids uuid[], p_request_id uuid, p_title text, p_body text, p_whatsapp boolean)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, request_id, title, body, whatsapp)
  select distinct u, p_request_id, p_title, p_body, p_whatsapp from unnest(p_user_ids) u where u is not null
$$;
revoke execute on function public._notify_ex(uuid[], uuid, text, text, boolean) from public, anon, authenticated;

-- notify_next_actor: who gets alerted at each step ------------------------------
--   submitted              -> department clerks + head
--   pending_head_*         -> department head
--   pending_admin_approval -> admins (with link)
--   approved               -> requester + department head (WhatsApp);
--                             disbursement + clerks (in-app only)
--   returned / rejected / paid -> requester
create or replace function public.notify_next_actor(p_request_id uuid, p_status public.request_status)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.requests; ids uuid[]; label text;
begin
  select * into r from public.requests where id = p_request_id;
  label := coalesce(r.request_no, 'Request') || ' - ' || r.title;
  if p_status = 'submitted' then
    select array_agg(id) into ids from public.profiles
      where role in ('clerk','head') and is_active and department_id = r.department_id and id <> r.requester_id;
    perform public._notify(ids, r.id, 'New request raised', label);
  elsif p_status in ('pending_head_approval','pending_head_review') then
    select array_agg(id) into ids from public.profiles
      where role = 'head' and is_active and department_id = r.department_id;
    perform public._notify(ids, r.id,
      case when p_status = 'pending_head_approval' then 'Request waiting for your approval'
           else 'Request waiting for your review' end, label);
  elsif p_status = 'pending_admin_approval' then
    select array_agg(id) into ids from public.profiles where role = 'admin' and is_active;
    perform public._notify(ids, r.id, 'Approval pending - Admin', label);
  elsif p_status = 'returned' then
    perform public._notify(array[r.requester_id], r.id, 'Returned for correction', label);
  elsif p_status = 'rejected' then
    perform public._notify(array[r.requester_id], r.id, 'Request rejected', label);
  elsif p_status = 'approved' then
    select array_agg(id) into ids from public.profiles
      where is_active and (id = r.requester_id or (role = 'head' and department_id = r.department_id));
    perform public._notify_ex(ids, r.id, 'Approved - ' || coalesce(r.approval_no, ''), label, true);
    select array_agg(id) into ids from public.profiles
      where is_active and id <> r.requester_id
        and (role = 'disbursement' or (role = 'clerk' and department_id = r.department_id));
    perform public._notify_ex(ids, r.id, 'Approved - ' || coalesce(r.approval_no, ''), label, false);
  elsif p_status = 'paid' then
    perform public._notify(array[r.requester_id], r.id, 'Paid', label);
  end if;
end $$;
revoke execute on function public.notify_next_actor(uuid, public.request_status) from public, anon, authenticated;

-- trigger: queue an HTTP call for each WhatsApp-enabled notification ----------
-- pg_net sends after commit; failures never block the workflow.
create or replace function public._whatsapp_hook()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cfg public.whatsapp_hook;
begin
  if not new.whatsapp then return new; end if;
  select * into cfg from public.whatsapp_hook where id = 1;
  if cfg.hook_url is null or not cfg.enabled then return new; end if;
  perform net.http_post(
    url := cfg.hook_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', cfg.hook_secret),
    timeout_milliseconds := 10000);
  return new;
exception when others then
  return new;
end $$;
revoke execute on function public._whatsapp_hook() from public, anon, authenticated;

drop trigger if exists notifications_whatsapp on public.notifications;
create trigger notifications_whatsapp after insert on public.notifications
  for each row execute function public._whatsapp_hook();

-- point the hook at the deployed Edge Function
update public.whatsapp_hook
  set hook_url = 'https://rwwbpyodelmofjujgtyf.supabase.co/functions/v1/whatsapp-notify'
  where id = 1 and hook_url is null;
