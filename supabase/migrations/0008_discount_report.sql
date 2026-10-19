-- 0008 — Discount report.
-- Admin always sees it; a Head sees it only when Admin grants can_view_discount_report.
-- The report covers every shop / department (company-wide), discount requests only.

alter table public.profiles
  add column if not exists can_view_discount_report boolean not null default false;

-- Admin grants / revokes report access for a Head
create or replace function public.set_discount_report_access(p_user_id uuid, p_allowed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; t public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then raise exception 'Only Admin can grant report access'; end if;
  select * into t from public.profiles where id = p_user_id;
  if t.id is null then raise exception 'User not found'; end if;
  if t.role <> 'head' then raise exception 'Report access can only be given to a Head'; end if;
  update public.profiles set can_view_discount_report = coalesce(p_allowed, false), updated_at = now()
   where id = t.id;
  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (me.id, me.full_name,
          case when p_allowed then 'discount_report_granted' else 'discount_report_revoked' end,
          'user', t.id::text, jsonb_build_object('username', t.username));
end $$;

-- One row per submitted discount request (drafts excluded) in the date window (by submitted date)
create or replace function public.discount_report(p_from date default null, p_to date default null)
returns table (
  id uuid, request_no text, title text, status public.request_status,
  shop_id uuid, shop_name text, department_id uuid, department_name text,
  requester_id uuid, requester_name text, approver_name text,
  submitted_at timestamptz, decided_at timestamptz,
  before_amount numeric, after_amount numeric, discount_amount numeric, discount_pct numeric,
  customer_name text, reference text
) language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := public._me();
  if not (me.role = 'admin' or (me.role = 'head' and me.can_view_discount_report)) then
    raise exception 'You do not have access to the discount report' using errcode = '42501';
  end if;
  return query
    select r.id, r.request_no, r.title, r.status,
           r.shop_id, coalesce(s.name, r.shop_name, 'No shop'), r.department_id, d.name,
           r.requester_id, r.requester_name, r.approver_name,
           r.submitted_at, r.decided_at,
           (r.details->>'before_amount')::numeric, (r.details->>'after_amount')::numeric,
           r.amount, coalesce((r.details->>'discount_pct')::numeric,
             case when (r.details->>'before_amount')::numeric > 0
                  then round(r.amount / (r.details->>'before_amount')::numeric * 100, 2) end),
           r.details->>'customer_name', r.details->>'reference'
      from public.requests r
      left join public.shops s on s.id = r.shop_id
      left join public.departments d on d.id = r.department_id
     where r.request_type = 'discount'
       and r.status <> 'draft'
       and (p_from is null or r.submitted_at >= p_from::timestamptz)
       and (p_to is null or r.submitted_at < (p_to + 1)::timestamptz)
     order by r.submitted_at desc nulls last;
end $$;

revoke execute on function public.set_discount_report_access(uuid, boolean) from public, anon;
grant execute on function public.set_discount_report_access(uuid, boolean) to authenticated;
revoke execute on function public.discount_report(date, date) from public, anon;
grant execute on function public.discount_report(date, date) to authenticated;
