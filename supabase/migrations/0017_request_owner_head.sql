-- Migration 0017: Store and auto-populate Request Owner Head
-- Ensures every request has owner_head_id and owner_head_name for clear accountability

alter table public.requests
  add column if not exists owner_head_id uuid references public.profiles(id) on delete set null,
  add column if not exists owner_head_name text;

create index if not exists requests_owner_head_id_idx on public.requests(owner_head_id);

-- Backfill from active department heads
update public.requests r
set
  owner_head_id = p.id,
  owner_head_name = p.full_name
from public.profiles p
where p.department_id = r.department_id
  and p.role = 'head'
  and p.is_active
  and (r.owner_head_name is null or r.owner_head_id is null);

-- Backfill fallback: if requester was head
update public.requests r
set
  owner_head_id = p.id,
  owner_head_name = p.full_name
from public.profiles p
where p.id = r.requester_id
  and p.role = 'head'
  and (r.owner_head_name is null or r.owner_head_id is null);

-- Trigger to auto-populate owner head on insert or when department changes
create or replace function public.set_request_owner_head()
returns trigger
language plpgsql
security definer
as $$
declare
  v_head_id uuid;
  v_head_name text;
begin
  if new.owner_head_name is null or new.owner_head_id is null then
    select id, full_name into v_head_id, v_head_name
    from public.profiles
    where department_id = new.department_id
      and role = 'head'
      and is_active
    order by created_at desc
    limit 1;

    if v_head_id is not null then
      new.owner_head_id := v_head_id;
      new.owner_head_name := v_head_name;
    elsif new.requester_role = 'head' then
      new.owner_head_id := new.requester_id;
      new.owner_head_name := new.requester_name;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_owner_head on public.requests;
create trigger trg_request_owner_head
  before insert or update of department_id on public.requests
  for each row
  execute function public.set_request_owner_head();

-- Update profiles_select policy so all authenticated users can view active department heads
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.my_role()) = 'admin'
    or ((select public.my_role()) in ('clerk','head') and department_id = (select public.my_department()))
    or (role = 'head' and is_active)
  );
