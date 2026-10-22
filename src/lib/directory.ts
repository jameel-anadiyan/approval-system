// Directory & admin operations. Live mode goes through RLS-guarded reads, the
// save_department / update_setting RPCs, and the admin-users / credentials Edge
// Functions (which hold the service key). Offline sandbox uses demo data.
import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeEdgeFunction } from './supabase';
import { useAuth } from '../context/AuthContext';
import { MOCK_DEPARTMENTS, MOCK_USERS, MOCK_AUDIT_LOGS, MOCK_SETTINGS, MOCK_REGIONS } from './mockData';
import type { AppRole, AuditLogEntry, Department, Profile, Region, RequestType, Shop, WorkCategory } from '../types/database';

type Result = { success: boolean; error?: string };

export interface NewUserInput {
  username: string;
  full_name: string;
  designation?: string;
  role: AppRole;
  department_id?: string | null;
  password?: string;
  shop_id?: string | null;
  allowed_types?: RequestType[];
  photo?: string;
  /** Regional Head: shops they cover */
  shop_ids?: string[];
  /** Regional Head: their assigned Region from Region Master */
  region_id?: string | null;
  /** Clerk: work categories they handle */
  category_ids?: string[];
  /** Employee: their Regional Head */
  regional_head_id?: string | null;
  /** Employee & Regional Head: heads they can submit requests to */
  head_ids?: string[];
  default_head_id?: string | null;
}

export interface AccessInput {
  shop_id: string | null;
  allowed_types: RequestType[];
  shop_ids?: string[];
  region_id?: string | null;
  category_ids?: string[];
  regional_head_id?: string | null;
  head_ids?: string[];
  default_head_id?: string | null;
}

export function useDirectory() {
  const { isBackendConnected, user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<WorkCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (isBackendConnected && user) {
        const [d, s, p, c, rRes] = await Promise.all([
          supabase.from('departments').select('*').order('name'),
          supabase.from('shops').select('*').order('name'),
          supabase
            .from('profiles')
            .select(
              '*, department:departments(*), shop:shops(*), region:regions(*), rh_shops:regional_head_shops!regional_head_shops_regional_head_id_fkey(shop_id), clerk_cats:clerk_categories!clerk_categories_clerk_id_fkey(category_id), user_heads:user_heads!user_heads_user_id_fkey(head_id, is_default)'
            )
            .order('created_at', { ascending: false }),
          supabase.from('work_categories').select('*').order('name'),
          supabase.from('regions').select('*').order('name'),
        ]);
        setDepartments((d.data as Department[]) ?? []);
        setShops((s.data as Shop[]) ?? []);
        setRegions((rRes.data as Region[]) ?? MOCK_REGIONS);
        if (p.error) {
          console.warn('Profiles load with embeds failed, using multi-query fallback:', p.error.message);
          try {
            const profileQuery = rRes.error
              ? supabase.from('profiles').select('*, department:departments(*), shop:shops(*)').order('created_at', { ascending: false })
              : supabase.from('profiles').select('*, department:departments(*), shop:shops(*), region:regions(*)').order('created_at', { ascending: false });

            const [basicRes, rhShopsRes, clerkCatsRes, userHeadsRes] = await Promise.all([
              profileQuery,
              supabase.from('regional_head_shops').select('regional_head_id, shop_id'),
              supabase.from('clerk_categories').select('clerk_id, category_id'),
              supabase.from('user_heads').select('user_id, head_id, is_default'),
            ]);
            const rhMap: Record<string, { shop_id: string }[]> = {};
            (rhShopsRes.data || []).forEach((r: any) => {
              if (!rhMap[r.regional_head_id]) rhMap[r.regional_head_id] = [];
              rhMap[r.regional_head_id].push({ shop_id: r.shop_id });
            });
            const catMap: Record<string, { category_id: string }[]> = {};
            (clerkCatsRes.data || []).forEach((c: any) => {
              if (!catMap[c.clerk_id]) catMap[c.clerk_id] = [];
              catMap[c.clerk_id].push({ category_id: c.category_id });
            });
            const headMap: Record<string, { head_id: string; is_default: boolean }[]> = {};
            (userHeadsRes.data || []).forEach((h: any) => {
              if (!headMap[h.user_id]) headMap[h.user_id] = [];
              headMap[h.user_id].push({ head_id: h.head_id, is_default: !!h.is_default });
            });
            const merged = ((basicRes.data as Profile[]) ?? []).map((u) => {
              const matchedRegion = (u.region_id && MOCK_REGIONS.find((rg) => rg.id === u.region_id)) || null;
              return {
                ...u,
                region: u.region ?? matchedRegion,
                rh_shops: rhMap[u.id] || [],
                clerk_cats: catMap[u.id] || [],
                user_heads: headMap[u.id] || [],
              };
            });
            setUsers(merged);
          } catch {
            // Never lose the staff list
            const basic = await supabase
              .from('profiles')
              .select('*, department:departments(*), shop:shops(*)')
              .order('created_at', { ascending: false });
            setUsers((basic.data as Profile[]) ?? []);
          }
        } else {
          setUsers((p.data as Profile[]) ?? []);
        }
        setCategories((c.data as WorkCategory[]) ?? []);
      } else {
        setDepartments(MOCK_DEPARTMENTS);
        setRegions(MOCK_REGIONS);
        setUsers(MOCK_USERS);
      }
    } catch (err) {
      console.error('Error reloading directory data:', err);
    } finally {
      setLoading(false);
    }
  }, [isBackendConnected, user?.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const live = isBackendConnected;

  const saveDepartment = async (input: { id?: string; name: string; code: string; is_active?: boolean }): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('save_department', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_code: input.code,
        p_is_active: input.is_active ?? true,
      });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    setDepartments((prev) =>
      input.id
        ? prev.map((d) => (d.id === input.id ? { ...d, ...input, is_active: input.is_active ?? d.is_active } : d))
        : [{ id: `dept-${Date.now()}`, name: input.name, code: input.code, is_active: true,
             created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...prev]
    );
    return { success: true };
  };

  const saveShop = async (input: { id?: string; name: string; code: string; is_active?: boolean }): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('save_shop', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_code: input.code,
        p_is_active: input.is_active ?? true,
      });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    setShops((prev) =>
      input.id
        ? prev.map((s) => (s.id === input.id ? { ...s, ...input, is_active: input.is_active ?? s.is_active } : s))
        : [{ id: `shop-${Date.now()}`, name: input.name, code: input.code, is_active: true,
             created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...prev]
    );
    return { success: true };
  };

  const createUser = async (input: NewUserInput): Promise<Result> => {
    if (live) {
      const { data, error } = await invokeEdgeFunction<{ id: string; username: string }>('admin-users', {
        action: 'create',
        ...input,
      });
      if (error) return { success: false, error: error.message };
      if (input.photo && data?.id) {
        await invokeEdgeFunction('admin-users', {
          action: 'set_photo',
          user_id: data.id,
          image: input.photo,
        });
      }
      await reload();
      return { success: true };
    }
    const dept = departments.find((d) => d.id === input.department_id);
    const shop = shops.find((s) => s.id === input.shop_id) ?? null;
    const region = regions.find((r) => r.id === input.region_id) ?? null;
    setUsers((prev) => [{
      id: `user-${Date.now()}`, username: input.username, full_name: input.full_name,
      designation: input.designation ?? null, role: input.role, department_id: input.department_id ?? null,
      is_active: true, must_change_password: true, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), department: dept,
      shop_id: input.shop_id ?? null, shop,
      region_id: input.region_id ?? null, region,
      allowed_types: input.allowed_types ?? ['general'],
      photo_path: input.photo || null,
      rh_shops: (input.shop_ids || []).map((shop_id) => ({ shop_id })),
      clerk_cats: (input.category_ids || []).map((category_id) => ({ category_id })),
      user_heads: (input.head_ids || []).map((head_id) => ({ head_id, is_default: head_id === input.default_head_id })),
    }, ...prev]);
    return { success: true };
  };

  /** Admin / Head changes a user's shop(s), request types, Regional Head or work categories. */
  const updateAccess = async (userId: string, access: AccessInput): Promise<Result> => {
    if (live) {
      const { error } = await invokeEdgeFunction('admin-users', { action: 'update_access', user_id: userId, ...access });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    const shop = shops.find((s) => s.id === access.shop_id) ?? null;
    const region = access.region_id ? regions.find((r) => r.id === access.region_id) ?? null : null;
    setUsers((prev) => prev.map((u) => (u.id === userId ? {
      ...u,
      ...access,
      shop,
      region_id: access.region_id !== undefined ? access.region_id : u.region_id,
      region: access.region_id !== undefined ? region : u.region,
      rh_shops: (access.shop_ids || []).map((shop_id) => ({ shop_id })),
      clerk_cats: (access.category_ids || []).map((category_id) => ({ category_id })),
      user_heads: (access.head_ids || []).map((head_id) => ({ head_id, is_default: head_id === access.default_head_id })),
    } : u)));
    return { success: true };
  };

  /** Head (own department) or Admin adds / renames / (de)activates a work category. */
  const saveCategory = async (input: {
    id?: string;
    name: string;
    is_active?: boolean;
    department_id?: string | null;
  }): Promise<Result> => {
    if (!live) return { success: false, error: 'Work categories need the live backend.' };
    const { error } = await supabase.rpc('save_work_category', {
      p_id: input.id ?? null,
      p_name: input.name,
      p_is_active: input.is_active ?? true,
      p_department_id: input.department_id ?? null,
    });
    if (error) return { success: false, error: error.message };
    await reload();
    return { success: true };
  };

  /** Admin grants / revokes a Head's access to the Discount Report. */
  const setDiscountReportAccess = async (userId: string, allowed: boolean): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('set_discount_report_access', { p_user_id: userId, p_allowed: allowed });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    setUsers((prev) => {
      const next = prev.map((u) => (u.id === userId ? { ...u, can_view_discount_report: allowed } : u));
      try {
        const saved = localStorage.getItem('approval_app_sandbox_user');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.id === userId) {
            parsed.can_view_discount_report = allowed;
            localStorage.setItem('approval_app_sandbox_user', JSON.stringify(parsed));
            window.dispatchEvent(new CustomEvent('approval_app_user_sync', { detail: parsed }));
          }
        }
      } catch {}
      return next;
    });
    return { success: true };
  };

  /** Admin grants / revokes a Head's access to the Special Waiting List Exhibition tab. */
  const setExhibitionWaitlistAccess = async (userId: string, allowed: boolean): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('set_exhibition_waitlist_access', { p_user_id: userId, p_allowed: allowed });
      if (error) {
        return {
          success: false,
          error: error.message.includes('does not exist')
            ? 'Database error: Please execute migration 0034_regions_and_exhibition_rules.sql in your Supabase SQL Editor.'
            : error.message,
        };
      }
      await reload();
      return { success: true };
    }
    setUsers((prev) => {
      const next = prev.map((u) => (u.id === userId ? { ...u, can_view_exhibition_waitlist: allowed } : u));
      try {
        const saved = localStorage.getItem('approval_app_sandbox_user');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.id === userId) {
            parsed.can_view_exhibition_waitlist = allowed;
            localStorage.setItem('approval_app_sandbox_user', JSON.stringify(parsed));
            window.dispatchEvent(new CustomEvent('approval_app_user_sync', { detail: parsed }));
          }
        }
      } catch {}
      return next;
    });
    return { success: true };
  };

  /** Admin adds / renames / (de)activates a region in Region Master (Head cannot manage this). */
  const saveRegion = async (input: { id?: string; name: string; code: string; is_active?: boolean }): Promise<Result> => {
    if (live) {
      // 1. Try RPC first
      const { error: rpcErr } = await supabase.rpc('save_region', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_code: input.code,
        p_is_active: input.is_active ?? true,
      });

      if (!rpcErr) {
        await reload();
        return { success: true };
      }

      // 2. Direct table fallback if table exists but RPC hasn't been reloaded
      if (
        rpcErr.message.includes('schema cache') ||
        rpcErr.message.includes('not found') ||
        rpcErr.message.includes('does not exist')
      ) {
        try {
          if (input.id) {
            const { error: updateErr } = await supabase
              .from('regions')
              .update({
                name: input.name.trim(),
                code: input.code.trim().toUpperCase(),
                is_active: input.is_active ?? true,
                updated_at: new Date().toISOString(),
              })
              .eq('id', input.id);
            if (!updateErr) {
              await reload();
              return { success: true };
            }
          } else {
            const { error: insertErr } = await supabase
              .from('regions')
              .insert({
                name: input.name.trim(),
                code: input.code.trim().toUpperCase(),
                is_active: input.is_active ?? true,
              });
            if (!insertErr) {
              await reload();
              return { success: true };
            }
          }
        } catch {
          // Fall through to friendly error
        }
      }

      return {
        success: false,
        error:
          rpcErr.message.includes('schema cache') || rpcErr.message.includes('does not exist')
            ? 'Database migration required: Please run migration 0034_regions_and_exhibition_rules.sql in your Supabase SQL Editor.'
            : rpcErr.message,
      };
    }
    setRegions((prev) =>
      input.id
        ? prev.map((r) => (r.id === input.id ? { ...r, ...input, is_active: input.is_active ?? r.is_active, updated_at: new Date().toISOString() } : r))
        : [{ id: `reg-${Date.now()}`, name: input.name, code: input.code, is_active: input.is_active ?? true,
             created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...prev]
    );
    return { success: true };
  };

  const setRegionActive = async (id: string, active: boolean): Promise<Result> => {
    const reg = regions.find((r) => r.id === id);
    if (!reg) return { success: false, error: 'Region not found' };
    return saveRegion({ ...reg, is_active: active });
  };

  const resetPassword = async (userId: string, password: string): Promise<Result> => {
    if (!live) return { success: true };
    const { error } = await invokeEdgeFunction('admin-users', { action: 'reset_password', user_id: userId, password });
    if (error) return { success: false, error: error.message };
    await reload();
    return { success: true };
  };

  const setActive = async (userId: string, active: boolean): Promise<Result> => {
    if (live) {
      const { error } = await invokeEdgeFunction('admin-users', { action: 'set_active', user_id: userId, active });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, is_active: active } : u)));
    return { success: true };
  };

  /** Admin uploads a seal or signature PNG for Admin or a Head via a one-time signed upload URL. */
  const uploadCredential = async (userId: string, kind: 'seal' | 'signature', file: File): Promise<Result> => {
    if (!live) return { success: true };
    if (file.type !== 'image/png') return { success: false, error: 'Seal and signature must be PNG files.' };
    const { data, error } = await invokeEdgeFunction<{ path: string; token: string }>('credentials', {
      action: 'upload_url', user_id: userId, kind,
    });
    if (error || !data) return { success: false, error: error?.message ?? 'Could not get upload link.' };
    const { error: upErr } = await supabase.storage
      .from('credentials')
      .uploadToSignedUrl(data.path, data.token, file, { contentType: 'image/png' });
    if (upErr) return { success: false, error: upErr.message };
    const { error: cErr } = await invokeEdgeFunction('credentials', {
      action: 'confirm', user_id: userId, kind, path: data.path,
    });
    if (cErr) return { success: false, error: cErr.message };
    return { success: true };
  };

  /** Sets or updates an employee / staff profile photo. */
  const setPhoto = async (userId: string, dataUrl: string): Promise<Result> => {
    if (live) {
      const { error } = await invokeEdgeFunction('admin-users', {
        action: 'set_photo',
        user_id: userId,
        image: dataUrl,
      });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, photo_path: dataUrl } : u)));
    return { success: true };
  };

  /** Removes an employee profile photo. */
  const removePhoto = async (userId: string): Promise<Result> => {
    if (live) {
      const { error } = await invokeEdgeFunction('admin-users', {
        action: 'remove_photo',
        user_id: userId,
      });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, photo_path: null } : u)));
    return { success: true };
  };

  return {
    departments, shops, regions, users, categories, loading, live, reload, saveDepartment, saveShop, saveRegion, setRegionActive,
    createUser, updateAccess, saveCategory, setDiscountReportAccess, setExhibitionWaitlistAccess, resetPassword, setActive,
    uploadCredential, setPhoto, removePhoto,
  };
}

export async function loadAuditLog(live: boolean): Promise<AuditLogEntry[]> {
  if (!live) return MOCK_AUDIT_LOGS;
  const { data } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
  return (data as AuditLogEntry[]) ?? [];
}

export async function loadThreshold(live: boolean): Promise<number> {
  if (!live) return MOCK_SETTINGS.high_value_threshold;
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'high_value_threshold').maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

export async function saveThreshold(live: boolean, value: number): Promise<Result> {
  if (!live) {
    MOCK_SETTINGS.high_value_threshold = value;
    return { success: true };
  }
  const { error } = await supabase.rpc('update_setting', { p_key: 'high_value_threshold', p_value: value });
  return error ? { success: false, error: error.message } : { success: true };
}
