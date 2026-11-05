-- ============================================================================
-- 0087_default_petty_cash_dealer.sql
--
-- Default Petty Cash Dealer:
-- 1. Adds `is_default_petty_cash_dealer` boolean flag on `public.profiles`.
-- 2. Creates RPC `public.set_default_petty_cash_dealer(p_user_id uuid, p_is_default boolean)`.
--    Ensures ONLY ONE Department Head can be the default Petty Cash Dealer at a time.
-- 3. Updates `public.set_petty_cash_dealer` so disabling a dealer clears default status.
-- 4. Updates `public.get_petty_cash_dealers()` to return `is_default` and sort default first.
-- ============================================================================

-- 1. Add column to profiles
alter table public.profiles
  add column if not exists is_default_petty_cash_dealer boolean not null default false;

-- Create partial unique index: at most one profile can be default petty cash dealer
create unique index if not exists idx_profiles_single_default_petty_cash_dealer
  on public.profiles (is_default_petty_cash_dealer)
  where is_default_petty_cash_dealer = true;

-- 2. Admin RPC to set or unset the Default Petty Cash Dealer
create or replace function public.set_default_petty_cash_dealer(
  p_user_id uuid,
  p_is_default boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  target public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can set the Default Petty Cash Dealer';
  end if;

  select * into target from public.profiles where id = p_user_id;
  if target.id is null then
    raise exception 'User not found';
  end if;
  if target.role <> 'head' then
    raise exception 'Only Department Heads can be Petty Cash Dealers';
  end if;

  if coalesce(p_is_default, true) = true then
    -- Must be enabled as petty cash dealer first
    if not target.is_petty_cash_dealer then
      update public.profiles
      set is_petty_cash_dealer = true
      where id = p_user_id;
    end if;

    -- Unset any existing default so only ONE default exists
    update public.profiles
    set is_default_petty_cash_dealer = false
    where is_default_petty_cash_dealer = true
      and id <> p_user_id;

    -- Set this target as default
    update public.profiles
    set is_default_petty_cash_dealer = true,
        is_petty_cash_dealer = true,
        updated_at = now()
    where id = p_user_id;
  else
    -- Unset default
    update public.profiles
    set is_default_petty_cash_dealer = false,
        updated_at = now()
    where id = p_user_id;
  end if;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (
    me.id,
    me.full_name,
    'default_petty_cash_dealer_changed',
    'user',
    target.id::text,
    jsonb_build_object(
      'username', target.username,
      'full_name', target.full_name,
      'is_default', coalesce(p_is_default, true)
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', target.id,
    'is_default_petty_cash_dealer', coalesce(p_is_default, true)
  );
end $$;

revoke execute on function public.set_default_petty_cash_dealer(uuid, boolean) from public, anon;
grant execute on function public.set_default_petty_cash_dealer(uuid, boolean) to authenticated;

-- 3. Update set_petty_cash_dealer so turning off dealer clears default status
create or replace function public.set_petty_cash_dealer(
  p_user_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  target public.profiles;
begin
  me := public._me();
  if me.role <> 'admin' then
    raise exception 'Only Admin can enable or disable Petty Cash Dealers';
  end if;

  select * into target from public.profiles where id = p_user_id;
  if target.id is null then
    raise exception 'User not found';
  end if;
  if target.role <> 'head' then
    raise exception 'Only Department Heads can be enabled as Petty Cash Dealers';
  end if;

  update public.profiles
  set is_petty_cash_dealer = coalesce(p_enabled, false),
      is_default_petty_cash_dealer = case when coalesce(p_enabled, false) = false then false else is_default_petty_cash_dealer end,
      updated_at = now()
  where id = p_user_id;

  insert into public.audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (
    me.id,
    me.full_name,
    'petty_cash_dealer_changed',
    'user',
    target.id::text,
    jsonb_build_object(
      'username', target.username,
      'full_name', target.full_name,
      'from', target.is_petty_cash_dealer,
      'to', coalesce(p_enabled, false)
    )
  );

  return jsonb_build_object(
    'success', true,
    'user_id', target.id,
    'is_petty_cash_dealer', coalesce(p_enabled, false)
  );
end $$;

revoke execute on function public.set_petty_cash_dealer(uuid, boolean) from public, anon;
grant execute on function public.set_petty_cash_dealer(uuid, boolean) to authenticated;

-- 4. Update get_petty_cash_dealers reader RPC to include is_default and sort default first
create or replace function public.get_petty_cash_dealers()
returns table (
  head_id uuid,
  head_name text,
  username text,
  designation text,
  department_id uuid,
  department_name text,
  is_default boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.id as head_id,
    h.full_name as head_name,
    h.username,
    h.designation,
    h.department_id,
    coalesce(d.name, 'Department') as department_name,
    coalesce(h.is_default_petty_cash_dealer, false) as is_default
  from public.profiles h
  left join public.departments d on d.id = h.department_id
  where h.role = 'head'
    and h.is_active = true
    and h.is_petty_cash_dealer = true
  order by coalesce(h.is_default_petty_cash_dealer, false) desc, h.full_name asc;
$$;

revoke execute on function public.get_petty_cash_dealers() from public, anon;
grant execute on function public.get_petty_cash_dealers() to authenticated;
