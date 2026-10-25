-- ============================================================================
-- 0039_production_cleanup_go_live.sql
-- PRODUCTION GO-LIVE CLEAN SLATE:
-- 1. Clears ALL test requests, uploaded files, signed PDFs, payments,
--    consultations, clarifications, timeline actions, and notifications.
-- 2. Resets all request & approval numbering sequences back to 000001.
-- 3. Deletes ALL test users, staff credentials, and logins except the Admin.
-- 4. Ensures a clean, active Admin account exists with known login credentials.
-- 5. Preserves Master Data (Departments, Shops, Regions, Work Categories, Settings).
-- ============================================================================

create extension if not exists pgcrypto;

do $$
declare
  v_admin_id uuid;
  v_admin_username text := 'admin';
  v_admin_pw text := 'Admin@2026'; -- Initial Admin password (change if desired)
  v_reset_admin_password boolean := true;
  v_login_domain text := 'users.approvalapp.in';
begin
  -- 1. Delete all operational request data (cascades cleanly)
  delete from public.request_files;
  delete from public.signed_files;
  delete from public.request_actions;
  delete from public.request_payments;
  delete from public.head_consultations;
  delete from public.disbursement_clarifications;
  delete from public.notifications;
  delete from public.requests;

  -- 2. Reset counters so production requests start at number 1 (e.g. REQ-2026-000001)
  delete from public.counters;

  -- 3. Clear all development/test audit logs
  delete from public.audit_log;

  -- 4. Remove staff-to-staff relations and non-admin approver credentials
  delete from public.user_heads;
  delete from public.clerk_categories;
  delete from public.regional_head_shops;
  delete from public.approver_credentials
    where user_id not in (select id from public.profiles where role = 'admin');

  -- 5. Clear self-referencing foreign keys on profiles & settings before deleting users
  update public.profiles set created_by = null, default_head_id = null, regional_head_id = null;
  update public.app_settings set updated_by = null;

  -- 6. Locate existing admin profile if one exists
  select id into v_admin_id from public.profiles where role = 'admin' order by created_at asc limit 1;

  if v_admin_id is not null then
    -- Existing admin found: ensure active status and clean role profile
    update public.profiles
    set username = v_admin_username,
        full_name = 'Administrator',
        designation = 'System Administrator',
        role = 'admin',
        department_id = null,
        shop_id = null,
        region_id = null,
        is_active = true,
        must_change_password = false,
        allowed_types = array[
          'general'::public.request_type,
          'discount'::public.request_type,
          'exhibition'::public.request_type,
          'asset'::public.request_type,
          'asset_below_20k'::public.request_type,
          'non_cash'::public.request_type
        ],
        updated_at = now()
    where id = v_admin_id;

    -- Update admin login email and password in auth.users
    if v_reset_admin_password then
      update auth.users
      set email = v_admin_username || '@' || v_login_domain,
          encrypted_password = crypt(v_admin_pw, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          raw_user_meta_data = jsonb_build_object('username', v_admin_username, 'full_name', 'Administrator'),
          updated_at = now()
      where id = v_admin_id;
    else
      update auth.users
      set email = v_admin_username || '@' || v_login_domain,
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          raw_user_meta_data = jsonb_build_object('username', v_admin_username, 'full_name', 'Administrator'),
          updated_at = now()
      where id = v_admin_id;
    end if;

  else
    -- No admin found: create fresh Administrator
    v_admin_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    )
    values (
      '00000000-0000-00-00-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      v_admin_username || '@' || v_login_domain,
      crypt(v_admin_pw, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', v_admin_username, 'full_name', 'Administrator'),
      now(),
      now(),
      '',
      ''
    );

    insert into public.profiles (
      id, username, full_name, designation, role,
      is_active, must_change_password, allowed_types, created_at, updated_at
    )
    values (
      v_admin_id, v_admin_username, 'Administrator', 'System Administrator', 'admin',
      true, false, array[
        'general'::public.request_type,
        'discount'::public.request_type,
        'exhibition'::public.request_type,
        'asset'::public.request_type,
        'asset_below_20k'::public.request_type,
        'non_cash'::public.request_type
      ], now(), now()
    );
  end if;

  -- Set app_settings updated_by to the active admin
  update public.app_settings set updated_by = v_admin_id;

  -- 7. Delete all profiles EXCEPT the Admin
  delete from public.profiles where id <> v_admin_id;

  -- 8. Delete all auth.users logins EXCEPT the Admin
  delete from auth.users where id <> v_admin_id;

  -- 9. Clean up storage files (safely inside PL/pgSQL block)
  begin
    delete from storage.objects where bucket_id in ('request-files', 'signed-files');
    delete from storage.objects
    where bucket_id = 'profile-photos'
      and (owner <> v_admin_id or split_part(name, '/', 1) <> v_admin_id::text);
  exception when others then
    null;
  end;

end $$;

notify pgrst, 'reload schema';
