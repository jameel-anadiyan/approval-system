// Directory & admin operations. Live mode goes through RLS-guarded reads, the
// save_department / update_setting RPCs, and the admin-users / credentials Edge
// Functions (which hold the service key). Offline sandbox uses demo data.
import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeEdgeFunction } from './supabase';
import { errMsg } from './errorUtils';
import { useAuth } from '../context/AuthContext';
import { MOCK_DEPARTMENTS, MOCK_USERS, MOCK_AUDIT_LOGS, MOCK_SETTINGS, MOCK_REGIONS, MOCK_REQUESTS, MOCK_PRODUCT_CATEGORIES } from './mockData';
import type { AppRole, AuditLogEntry, ConnectedEntryAccount, Department, DisbursementAccountType, ProductCategory, Profile, Region, RequestType, Shop, WorkCategory } from '../types/database';
import { isEntryCheckingUser } from './formatters';

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
  /** Disbursement: Entry Only vs Payment Only */
  disbursement_type?: DisbursementAccountType | null;
  /** Payment Only: cash, bank, or both */
  payment_dealer_type?: 'cash' | 'bank' | 'both' | null;
  /** Payment Only: connected Entry Only accounts */
  connected_entry_accounts?: string[];
  /** Department Head: whether consultation is mandatory */
  mandatory_head_consultation?: boolean;
  /** Department Head: designated consultation head id */
  mandatory_consultation_head_id?: string | null;
  /** Entry / Payment account: people who share this login, each with their own 4-digit passkey */
  account_persons?: AccountPersonInput[];
  /** WhatsApp mobile number with country code */
  whatsapp_number?: string | null;
}

export interface AccountPersonInput {
  name: string;
  /** Exactly 4 digits - only sent to the server, never stored in plain text */
  passkey: string;
}

/** A person (name only - passkeys are never readable) on a shared disbursement login. */
export interface DisbursementPerson {
  id: string;
  account_id: string;
  person_name: string;
  is_active: boolean;
  created_at: string;
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
  disbursement_type?: DisbursementAccountType | null;
  payment_dealer_type?: 'cash' | 'bank' | 'both' | null;
  connected_entry_accounts?: string[];
  mandatory_head_consultation?: boolean;
  mandatory_consultation_head_id?: string | null;
}

/** Offline sandbox store for disbursement persons (live mode keeps them in the database). */
const mockPersons: DisbursementPerson[] = [];

const toAccountObjs = (ids: string[] = [], userList: Profile[] = []): ConnectedEntryAccount[] =>
  ids.map((id) => ({
    entry_user_id: id,
    entry_user_name: userList.find((u) => u.id === id)?.full_name || undefined,
  }));

export function useDirectory() {
  const { isBackendConnected, user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<WorkCategory[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>(MOCK_PRODUCT_CATEGORIES);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (isBackendConnected && user) {
        const [d, s, p, c, rRes, pcRes] = await Promise.all([
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
          supabase.from('product_categories').select('*').order('name'),
        ]);
        setDepartments((d.data as Department[]) ?? []);
        setShops((s.data as Shop[]) ?? []);
        if (pcRes?.data && pcRes.data.length > 0) {
          setProductCategories(pcRes.data as ProductCategory[]);
        } else if (!pcRes?.error) {
          setProductCategories((pcRes?.data as ProductCategory[]) ?? []);
        } else {
          setProductCategories(MOCK_PRODUCT_CATEGORIES);
        }
        const loadedRegions = (rRes.data as Region[]) || [];
        const activeRegionList = loadedRegions.length > 0 ? loadedRegions : MOCK_REGIONS;
        setRegions(activeRegionList);
        let mappingsData: Array<{ payment_user_id: string; entry_user_id: string }> = [];
        try {
          const mRes = await supabase.from('payment_entry_account_mappings').select('*');
          if (mRes.data) mappingsData = mRes.data as Array<{ payment_user_id: string; entry_user_id: string }>;
        } catch {
          // ignore if table not yet migrated
        }
        const mappingByPayment: Record<string, string[]> = {};
        mappingsData.forEach((m) => {
          if (!mappingByPayment[m.payment_user_id]) mappingByPayment[m.payment_user_id] = [];
          mappingByPayment[m.payment_user_id].push(m.entry_user_id);
        });

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
              const matchedRegion = (u.region_id && activeRegionList.find((rg) => rg.id === u.region_id)) || null;
              return {
                ...u,
                region: u.region ?? matchedRegion,
                rh_shops: rhMap[u.id] || [],
                clerk_cats: catMap[u.id] || [],
                user_heads: headMap[u.id] || [],
                connected_entry_accounts: mappingByPayment[u.id] ? toAccountObjs(mappingByPayment[u.id]) : (u.connected_entry_accounts || []),
              };
            });
            setUsers(merged);
          } catch {
            // Never lose the staff list
            const basic = await supabase
              .from('profiles')
              .select('*, department:departments(*), shop:shops(*)')
              .order('created_at', { ascending: false });
            const basicMapped = ((basic.data as Profile[]) ?? []).map((u) => ({
              ...u,
              region: u.region ?? (u.region_id ? activeRegionList.find((rg) => rg.id === u.region_id) || null : null),
              connected_entry_accounts: mappingByPayment[u.id] ? toAccountObjs(mappingByPayment[u.id]) : (u.connected_entry_accounts || []),
            }));
            setUsers(basicMapped);
          }
        } else {
          const merged = ((p.data as Profile[]) ?? []).map((u) => ({
            ...u,
            region: u.region ?? (u.region_id ? activeRegionList.find((rg) => rg.id === u.region_id) || null : null),
            connected_entry_accounts: mappingByPayment[u.id] ? toAccountObjs(mappingByPayment[u.id]) : (u.connected_entry_accounts || []),
          }));
          setUsers(merged);
        }

        // Ensure active Entry Only disbursement accounts are included for Clerk & Head routing/assignment
        if (user && (user.role === 'clerk' || user.role === 'head')) {
          try {
            const { data: rpcOfficers, error: rpcErr } = await supabase.rpc('get_active_entry_only_users');
            let eoList: Profile[] = [];
            if (!rpcErr && rpcOfficers && (rpcOfficers as Profile[]).length > 0) {
              eoList = rpcOfficers as Profile[];
            } else {
              const { data: directProfiles } = await supabase
                .from('profiles')
                .select('*')
                .eq('role', 'disbursement')
                .eq('disbursement_type', 'entry_only')
                .eq('is_active', true);
              if (directProfiles && directProfiles.length > 0) {
                eoList = directProfiles as Profile[];
              }
            }
            const filteredEo = eoList.filter((eo) => !isEntryCheckingUser(eo));
            if (filteredEo.length > 0) {
              setUsers((prev) => {
                const map = new Map<string, Profile>(prev.map((u) => [u.id, u]));
                for (const eo of filteredEo) {
                  if (!map.has(eo.id)) {
                    map.set(eo.id, eo);
                  }
                }
                return Array.from(map.values());
              });
            }
          } catch (e) {
            console.warn('Could not load entry-only disbursement officers:', e);
          }
        }

        setCategories((c.data as WorkCategory[]) ?? []);
      } else {
        setDepartments(MOCK_DEPARTMENTS);
        setRegions(MOCK_REGIONS);
        setUsers(MOCK_USERS);
        setProductCategories(MOCK_PRODUCT_CATEGORIES);
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
      if (error) return { success: false, error: errMsg(error) };
      await reload();
      return { success: true };
    }
    setDepartments((prev) =>
      input.id
        ? prev.map((d) => (d.id === input.id ? { ...d, ...input, is_active: input.is_active ?? d.is_active } : d))
        : [{
          id: `dept-${Date.now()}`, name: input.name, code: input.code, is_active: true,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        }, ...prev]
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
      if (error) return { success: false, error: errMsg(error) };
      await reload();
      return { success: true };
    }
    setShops((prev) =>
      input.id
        ? prev.map((s) => (s.id === input.id ? { ...s, ...input, is_active: input.is_active ?? s.is_active } : s))
        : [{
          id: `shop-${Date.now()}`, name: input.name, code: input.code, is_active: true,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        }, ...prev]
    );
    return { success: true };
  };

  const createUser = async (input: NewUserInput): Promise<Result> => {
    if (live) {
      const { account_persons: accountPersons, ...createInput } = input;
      const { data, error } = await invokeEdgeFunction<{ id: string; username: string }>('admin-users', {
        action: 'create',
        ...createInput,
      });
      if (error) return { success: false, error: errMsg(error) };

      // Ensure region_id is assigned directly via RPC or direct update
      if (input.region_id && data?.id) {
        const { error: rpcErr } = await supabase.rpc('set_user_region', {
          p_user_id: data.id,
          p_region_id: input.region_id,
        });
        if (rpcErr) {
          await supabase
            .from('profiles')
            .update({ region_id: input.region_id, updated_at: new Date().toISOString() })
            .eq('id', data.id);
        }
      }

      // Ensure whatsapp_number is persisted directly to profiles
      if (input.whatsapp_number && data?.id) {
        await supabase
          .from('profiles')
          .update({ whatsapp_number: input.whatsapp_number.trim(), updated_at: new Date().toISOString() })
          .eq('id', data.id);
      }

      let personError: string | null = null;
      if (input.role === 'disbursement' && input.disbursement_type && data?.id) {
        await supabase.rpc('set_user_disbursement_type', {
          p_user_id: data.id,
          p_type: input.disbursement_type,
        });
        if (input.disbursement_type === 'payment_only') {
          await supabase.rpc('set_payment_dealer_config', {
            p_user_id: data.id,
            p_dealer_type: input.payment_dealer_type || 'both',
            p_entry_user_ids: (input.connected_entry_accounts || []).length > 0 ? input.connected_entry_accounts : null,
          });
        }
        // Entry / Payment accounts: register every person with their own 4-digit passkey
        if (input.disbursement_type === 'entry_only' || input.disbursement_type === 'payment_only') {
          for (const person of accountPersons || []) {
            const { error: personErr } = await supabase.rpc('add_disbursement_person', {
              p_account_id: data.id,
              p_name: person.name,
              p_passkey: person.passkey,
            });
            if (personErr) {
              personError = `Account created, but ${person.name} could not be added: ${errMsg(personErr)}. Add the persons from the account's "Persons & Passkeys" button.`;
              break;
            }
          }
        }
      }

      if (input.role === 'head' && input.mandatory_head_consultation && input.mandatory_consultation_head_id && data?.id) {
        await supabase.rpc('set_head_mandatory_consultation', {
          p_user_id: data.id,
          p_enabled: true,
          p_target_head_id: input.mandatory_consultation_head_id,
        });
      }

      if (input.photo && data?.id) {
        await invokeEdgeFunction('admin-users', {
          action: 'set_photo',
          user_id: data.id,
          image: input.photo,
        });
      }
      await reload();
      if (personError) return { success: false, error: personError };
      return { success: true };
    }
    const dept = departments.find((d) => d.id === input.department_id);
    const shop = shops.find((s) => s.id === input.shop_id) ?? null;
    const region = regions.find((r) => r.id === input.region_id) ?? null;
    const targetConsultHead = input.mandatory_consultation_head_id ? users.find((u) => u.id === input.mandatory_consultation_head_id) : null;
    const newUserId = `user-${Date.now()}`;
    if (input.role === 'disbursement') {
      (input.account_persons || []).forEach((p) => {
        mockPersons.push({
          id: `person-${Date.now()}-${mockPersons.length}`,
          account_id: newUserId,
          person_name: p.name.trim(),
          is_active: true,
          created_at: new Date().toISOString(),
        });
      });
    }
    setUsers((prev) => [{
      id: newUserId, username: input.username, full_name: input.full_name,
      designation: input.designation ?? null, role: input.role, department_id: input.department_id ?? null,
      is_active: true, must_change_password: true, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), department: dept,
      shop_id: input.shop_id ?? null, shop,
      region_id: input.region_id ?? null, region,
      allowed_types: input.allowed_types ?? ['general'],
      photo_path: input.photo || null,
      whatsapp_number: input.whatsapp_number || null,
      disbursement_type: input.role === 'disbursement' ? (input.disbursement_type || 'entry_only') : null,
      payment_dealer_type: input.role === 'disbursement' && input.disbursement_type === 'payment_only' ? (input.payment_dealer_type || 'both') : null,
      connected_entry_accounts: toAccountObjs(input.connected_entry_accounts || [], users),
      mandatory_head_consultation: input.role === 'head' ? !!input.mandatory_head_consultation : false,
      mandatory_consultation_head_id: input.role === 'head' && input.mandatory_head_consultation ? input.mandatory_consultation_head_id : null,
      mandatory_consultation_head_name: input.role === 'head' && input.mandatory_head_consultation && targetConsultHead ? targetConsultHead.full_name : null,
      rh_shops: (input.shop_ids || []).map((shop_id) => ({ shop_id })),
      clerk_cats: (input.category_ids || []).map((category_id) => ({ category_id })),
      user_heads: (input.head_ids || []).map((head_id) => ({ head_id, is_default: head_id === input.default_head_id })),
    }, ...prev]);
    return { success: true };
  };

  /** Admin / Head changes a user's shop(s), request types, Regional Head, Region or work categories. */
  const updateAccess = async (userId: string, access: AccessInput): Promise<Result> => {
    if (live) {
      // 1. Directly persist region_id to guarantee persistence in live PostgreSQL
      if (access.region_id !== undefined) {
        await setUserRegion(userId, access.region_id || null);
      }

      // 2. Persist disbursement_type if provided
      if (access.disbursement_type !== undefined && access.disbursement_type !== null) {
        await setDisbursementType(userId, access.disbursement_type);
      }

      // 3. Persist payment_dealer_type & connected_entry_accounts if provided
      if (access.payment_dealer_type !== undefined || access.connected_entry_accounts !== undefined) {
        await setPaymentDealerConfig(
          userId,
          access.payment_dealer_type || 'both',
          access.connected_entry_accounts || []
        );
      }

      // 4. Persist mandatory_head_consultation if provided
      if (access.mandatory_head_consultation !== undefined) {
        await setHeadMandatoryConsultation(
          userId,
          !!access.mandatory_head_consultation,
          access.mandatory_consultation_head_id || null
        );
      }

      // 5. Invoke Edge Function for shop_ids, categories, heads
      const { error } = await invokeEdgeFunction('admin-users', { action: 'update_access', user_id: userId, ...access });
      if (error && access.region_id === undefined && access.disbursement_type === undefined) return { success: false, error: errMsg(error) };

      await reload();
      return { success: true };
    }
    const shop = shops.find((s) => s.id === access.shop_id) ?? null;
    const region = access.region_id ? regions.find((r) => r.id === access.region_id) ?? null : null;
    setUsers((prev) => prev.map((u) => (u.id === userId ? {
      ...u,
      ...access,
      shop,
      region_id: access.region_id !== undefined ? (access.region_id || null) : u.region_id,
      region: access.region_id !== undefined ? region : u.region,
      disbursement_type: access.disbursement_type !== undefined ? access.disbursement_type : u.disbursement_type,
      payment_dealer_type: access.payment_dealer_type !== undefined ? access.payment_dealer_type : u.payment_dealer_type,
      connected_entry_accounts: access.connected_entry_accounts !== undefined ? toAccountObjs(access.connected_entry_accounts, users) : u.connected_entry_accounts,
      mandatory_head_consultation: access.mandatory_head_consultation !== undefined ? access.mandatory_head_consultation : u.mandatory_head_consultation,
      mandatory_consultation_head_id: access.mandatory_consultation_head_id !== undefined ? access.mandatory_consultation_head_id : u.mandatory_consultation_head_id,
      mandatory_consultation_head_name: access.mandatory_consultation_head_id !== undefined
        ? (users.find((h) => h.id === access.mandatory_consultation_head_id)?.full_name || null)
        : u.mandatory_consultation_head_name,
      rh_shops: (access.shop_ids || []).map((shop_id) => ({ shop_id })),
      clerk_cats: (access.category_ids || []).map((category_id) => ({ category_id })),
      user_heads: (access.head_ids || []).map((head_id) => ({ head_id, is_default: head_id === access.default_head_id })),
    } : u)));
    return { success: true };
  };

  /** Explicitly assign or clear a user's Region (Admin or Head). */
  const setUserRegion = async (userId: string, regionId: string | null): Promise<Result> => {
    const cleanId = regionId && regionId.trim() ? regionId.trim() : null;
    if (live) {
      // Optimistic local update so UI reflects immediately
      const matched = cleanId ? regions.find((r) => r.id === cleanId) ?? null : null;
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, region_id: cleanId, region: matched } : u)));

      const { error: rpcErr } = await supabase.rpc('set_user_region', {
        p_user_id: userId,
        p_region_id: cleanId,
      });
      if (rpcErr) {
        console.warn('set_user_region RPC note, trying direct update:', rpcErr.message);
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ region_id: cleanId, updated_at: new Date().toISOString() })
          .eq('id', userId);
        if (updateErr) {
          console.error('Direct region update failed:', updateErr.message);
          await reload();
          return {
            success: false,
            error:
              rpcErr.message.includes('permission') || updateErr.message.includes('permission')
                ? 'Database permission error: Please execute migration 0035_set_user_region_rpc.sql in Supabase SQL Editor.'
                : (rpcErr.message || updateErr.message),
          };
        }
      }
      await reload();
      return { success: true };
    }
    const region = cleanId ? regions.find((r) => r.id === cleanId) ?? null : null;
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, region_id: cleanId, region } : u)));
    return { success: true };
  };

  /** Admin assigns a disbursement user's account type (Entry Only vs Payment Only). */
  const setDisbursementType = async (userId: string, type: DisbursementAccountType): Promise<Result> => {
    if (live) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, disbursement_type: type } : u)));
      const { error: rpcErr } = await supabase.rpc('set_user_disbursement_type', {
        p_user_id: userId,
        p_type: type,
      });
      if (rpcErr) {
        console.warn('set_user_disbursement_type RPC note, trying direct update:', rpcErr.message);
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ disbursement_type: type, updated_at: new Date().toISOString() })
          .eq('id', userId);
        if (updateErr) {
          console.error('Direct disbursement_type update failed:', updateErr.message);
          await reload();
          return { success: false, error: rpcErr.message || updateErr.message };
        }
      }
      await reload();
      return { success: true };
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, disbursement_type: type } : u)));
    return { success: true };
  };

  /** Admin configures payment user dealer mode ('cash' | 'bank' | 'both') and mapped entry accounts. */
  const setPaymentDealerConfig = async (
    userId: string,
    dealerType: 'cash' | 'bank' | 'both',
    entryUserIds: string[] = []
  ): Promise<Result> => {
    if (live) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? { ...u, payment_dealer_type: dealerType, connected_entry_accounts: toAccountObjs(entryUserIds, users) }
            : u
        )
      );
      const { error: rpcErr } = await supabase.rpc('set_payment_dealer_config', {
        p_user_id: userId,
        p_dealer_type: dealerType,
        p_entry_user_ids: entryUserIds.length > 0 ? entryUserIds : null,
      });
      if (rpcErr) {
        console.warn('set_payment_dealer_config RPC error:', rpcErr.message);
        await reload();
        return { success: false, error: rpcErr.message };
      }
      await reload();
      return { success: true };
    }
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? { ...u, payment_dealer_type: dealerType, connected_entry_accounts: toAccountObjs(entryUserIds, users) }
          : u
      )
    );
    return { success: true };
  };

  /** Admin configures mandatory other head consultation for a department head. */
  const setHeadMandatoryConsultation = async (
    userId: string,
    enabled: boolean,
    targetHeadId?: string | null
  ): Promise<Result> => {
    if (live) {
      const { error: rpcErr } = await supabase.rpc('set_head_mandatory_consultation', {
        p_user_id: userId,
        p_enabled: enabled,
        p_target_head_id: enabled && targetHeadId ? targetHeadId : null,
      });
      if (rpcErr) {
        console.warn('set_head_mandatory_consultation RPC error:', rpcErr.message);
        await reload();
        return { success: false, error: rpcErr.message };
      }
      await reload();
      return { success: true };
    }
    const targetHead = targetHeadId ? users.find((u) => u.id === targetHeadId) : null;
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
            ...u,
            mandatory_head_consultation: enabled,
            mandatory_consultation_head_id: enabled ? (targetHeadId || null) : null,
            mandatory_consultation_head_name: enabled && targetHead ? targetHead.full_name : null,
          }
          : u
      )
    );
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
    if (error) return { success: false, error: errMsg(error) };
    await reload();
    return { success: true };
  };

  /** Admin adds / renames / (de)activates a product category. */
  const saveProductCategory = async (input: {
    id?: string;
    name: string;
    is_active?: boolean;
  }): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('save_product_category', {
        p_id: input.id ?? null,
        p_name: input.name,
        p_is_active: input.is_active ?? true,
      });
      if (error) {
        const cleanName = input.name.trim();
        const active = input.is_active ?? true;
        const res = input.id
          ? await supabase.from('product_categories').update({ name: cleanName, is_active: active, updated_at: new Date().toISOString() }).eq('id', input.id)
          : await supabase.from('product_categories').insert({ name: cleanName, is_active: active });
        if (res.error) return { success: false, error: errMsg(res.error) || errMsg(error) };
      }
      await reload();
      return { success: true };
    }
    setProductCategories((prev) =>
      input.id
        ? prev.map((c) => (c.id === input.id ? { ...c, ...input, is_active: input.is_active ?? c.is_active } : c))
        : [{ id: `pcat-${Date.now()}`, name: input.name, is_active: input.is_active ?? true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...prev]
    );
    return { success: true };
  };

  /** Admin toggles active state of a product category */
  const setProductCategoryActive = async (id: string, active: boolean): Promise<Result> => {
    if (live) {
      const { error } = await supabase.from('product_categories').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) return { success: false, error: errMsg(error) };
      await reload();
      return { success: true };
    }
    setProductCategories((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: active } : c)));
    return { success: true };
  };

  /** Admin grants / revokes a Head's access to the Discount Report. */
  const setDiscountReportAccess = async (userId: string, allowed: boolean): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('set_discount_report_access', { p_user_id: userId, p_allowed: allowed });
      if (error) return { success: false, error: errMsg(error) };
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
      } catch { }
      return next;
    });
    return { success: true };
  };

  /** Admin grants / revokes any user's access to the Stock Transfer Report tab. */
  const setStockTransferReportAccess = async (userId: string, allowed: boolean): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('set_stock_transfer_report_access', { p_user_id: userId, p_allowed: allowed });
      if (error) {
        return {
          success: false,
          error:
            error.message.includes('does not exist') || error.message.includes('schema cache')
              ? 'Database migration required: run 0049_request_shop_and_stock_transfer_monitor.sql in the Supabase SQL Editor.'
              : error.message,
        };
      }
      await reload();
      return { success: true };
    }
    setUsers((prev) => {
      const next = prev.map((u) => (u.id === userId ? { ...u, can_view_stock_transfer_report: allowed } : u));
      try {
        const saved = localStorage.getItem('approval_app_sandbox_user');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.id === userId) {
            parsed.can_view_stock_transfer_report = allowed;
            localStorage.setItem('approval_app_sandbox_user', JSON.stringify(parsed));
            window.dispatchEvent(new CustomEvent('approval_app_user_sync', { detail: parsed }));
          }
        }
      } catch { }
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
      } catch { }
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
        : [{
          id: `reg-${Date.now()}`, name: input.name, code: input.code, is_active: input.is_active ?? true,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        }, ...prev]
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
    if (error) return { success: false, error: errMsg(error) };
    await reload();
    return { success: true };
  };

  const setActive = async (userId: string, active: boolean): Promise<Result> => {
    if (live) {
      const { error } = await invokeEdgeFunction('admin-users', { action: 'set_active', user_id: userId, active });
      if (error) return { success: false, error: errMsg(error) };
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
    if (error || !data) return { success: false, error: error ? errMsg(error) : 'Could not get upload link.' };
    const { error: upErr } = await supabase.storage
      .from('credentials')
      .uploadToSignedUrl(data.path, data.token, file, { contentType: 'image/png' });
    if (upErr) return { success: false, error: errMsg(upErr) };
    const { error: cErr } = await invokeEdgeFunction('credentials', {
      action: 'confirm', user_id: userId, kind, path: data.path,
    });
    if (cErr) return { success: false, error: errMsg(cErr) };
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
      if (error) return { success: false, error: errMsg(error) };
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
      if (error) return { success: false, error: errMsg(error) };
      await reload();
      return { success: true };
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, photo_path: null } : u)));
    return { success: true };
  };

  /** Update user name, username, designation and whatsapp number */
  const updateUserDetails = async (
    userId: string,
    data: { full_name: string; username: string; designation?: string | null; whatsapp_number?: string | null }
  ): Promise<Result> => {
    const cleanFullName = data.full_name.trim();
    const cleanUsername = data.username.trim().toLowerCase();
    const cleanDesignation = data.designation?.trim() || null;
    const cleanWhatsApp = data.whatsapp_number?.trim() || null;

    if (!cleanFullName) {
      return { success: false, error: 'Please enter the full name.' };
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      return { success: false, error: 'Username must be 3–30 characters using lowercase letters, numbers, dot, dash, or underscore.' };
    }

    if (live) {
      // 1. Try RPC update_user_details first (most reliable, handles auth.users and RLS)
      const { error: rpcErr } = await supabase.rpc('update_user_details', {
        p_user_id: userId,
        p_full_name: cleanFullName,
        p_username: cleanUsername,
        p_designation: cleanDesignation,
        p_whatsapp_number: cleanWhatsApp,
      });

      if (rpcErr) {
        console.warn('update_user_details RPC returned an error, attempting direct profiles update:', rpcErr);

        // 2. Direct profiles table update fallback
        const { error: pErr } = await supabase
          .from('profiles')
          .update({
            full_name: cleanFullName,
            username: cleanUsername,
            designation: cleanDesignation,
            whatsapp_number: cleanWhatsApp,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (pErr) {
          console.warn('Direct profiles update returned an error, attempting edge function fallback:', pErr);

          // 3. Edge function fallback
          const { error: fnErr } = await invokeEdgeFunction('admin-users', {
            action: 'update',
            user_id: userId,
            full_name: cleanFullName,
            username: cleanUsername,
            designation: cleanDesignation,
            whatsapp_number: cleanWhatsApp,
          });

          if (fnErr) {
            return {
              success: false,
              error: pErr.message || rpcErr.message || fnErr.message || 'Failed to save user details.',
            };
          }
        }
      }

      // Optimistically update users in state so changes appear on screen immediately
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
              ...u,
              full_name: cleanFullName,
              username: cleanUsername,
              designation: cleanDesignation,
              whatsapp_number: cleanWhatsApp,
              updated_at: new Date().toISOString(),
            }
            : u
        )
      );

      // If updating the currently logged-in user, sync auth state across app
      const targetUser = users.find((u) => u.id === userId);
      if (targetUser) {
        const synced = {
          ...targetUser,
          full_name: cleanFullName,
          username: cleanUsername,
          designation: cleanDesignation,
          whatsapp_number: cleanWhatsApp,
        };
        window.dispatchEvent(new CustomEvent('approval_app_user_sync', { detail: synced }));
      }

      await reload();
      return { success: true };
    }

    // Mock / Sandbox mode
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
            ...u,
            full_name: cleanFullName,
            username: cleanUsername,
            designation: cleanDesignation,
            updated_at: new Date().toISOString(),
          }
          : u
      )
    );
    const targetUser = users.find((u) => u.id === userId);
    if (targetUser) {
      const synced = {
        ...targetUser,
        full_name: cleanFullName,
        username: cleanUsername,
        designation: cleanDesignation,
      };
      window.dispatchEvent(new CustomEvent('approval_app_user_sync', { detail: synced }));
    }
    return { success: true };
  };

  /** Checks if a user has any associated requests or workflow actions */
  const checkCanDeleteUser = async (
    userId: string
  ): Promise<{ canDelete: boolean; reason: string; requestCount: number }> => {
    if (live) {
      const { data, error } = await supabase.rpc('can_delete_user', { p_user_id: userId });
      if (!error && data) {
        return {
          canDelete: Boolean(data.can_delete),
          reason: data.reason || '',
          requestCount: Number(data.request_count || 0),
        };
      }
      // Fallback: direct table queries
      try {
        const [r1, r2, r3, r4] = await Promise.all([
          supabase
            .from('requests')
            .select('id', { count: 'exact', head: true })
            .or(
              `requester_id.eq.${userId},owner_head_id.eq.${userId},routed_by.eq.${userId},reviewed_by.eq.${userId},decided_by.eq.${userId},paid_by.eq.${userId},cancelled_by.eq.${userId},quote_selected_by.eq.${userId},regional_head_id.eq.${userId}`
            ),
          supabase.from('request_actions').select('id', { count: 'exact', head: true }).eq('actor_id', userId),
          supabase.from('request_files').select('id', { count: 'exact', head: true }).eq('added_by', userId),
          supabase.from('head_consultations').select('id', { count: 'exact', head: true }).eq('head_id', userId),
        ]);
        const total = (r1.count || 0) + (r2.count || 0) + (r3.count || 0) + (r4.count || 0);
        if (total > 0) {
          return { canDelete: false, requestCount: total, reason: `User has ${total} associated request(s) or workflow action(s).` };
        }
        return { canDelete: true, requestCount: 0, reason: 'No associated requests.' };
      } catch (err: any) {
        console.warn('Fallback check failed:', err);
        return { canDelete: true, requestCount: 0, reason: '' };
      }
    }
    // Mock mode: check MOCK_REQUESTS
    const count = MOCK_REQUESTS.filter(
      (r) =>
        r.requester_id === userId ||
        r.owner_head_id === userId ||
        r.routed_by === userId ||
        r.decided_by === userId ||
        r.paid_by === userId ||
        r.cancelled_by === userId ||
        (r.actions || []).some((a) => a.actor_id === userId)
    ).length;
    return {
      canDelete: count === 0,
      requestCount: count,
      reason: count > 0 ? `User has ${count} associated mock request(s).` : 'No associated requests.',
    };
  };

  /** Permanently delete user if no associated requests exist */
  const deleteUser = async (userId: string): Promise<Result> => {
    // Optimistically remove from state so the card immediately vanishes
    setUsers((prev) => prev.filter((u) => u.id !== userId));

    if (live) {
      // 1. Try RPC delete_user_account first
      const { error: rpcErr } = await supabase.rpc('delete_user_account', { p_user_id: userId });
      if (!rpcErr) {
        await reload();
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        return { success: true };
      }

      console.warn('delete_user_account RPC error:', rpcErr);

      // 2. Try Edge function
      const { error: fnErr } = await invokeEdgeFunction('admin-users', {
        action: 'delete',
        user_id: userId,
      });
      if (!fnErr) {
        await reload();
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        return { success: true };
      }

      console.warn('admin-users edge function error:', fnErr);

      // 3. Fallback: clean up relational rows and delete from profiles
      try {
        await Promise.allSettled([
          supabase.from('regional_head_shops').delete().eq('regional_head_id', userId),
          supabase.from('clerk_categories').delete().eq('clerk_id', userId),
          supabase.from('user_heads').delete().or(`user_id.eq.${userId},head_id.eq.${userId}`),
          supabase.from('approver_credentials').delete().eq('user_id', userId),
          supabase.from('profiles').update({ default_head_id: null }).eq('default_head_id', userId),
          supabase.from('profiles').update({ regional_head_id: null }).eq('regional_head_id', userId),
          supabase.from('profiles').update({ created_by: null }).eq('created_by', userId),
          supabase.from('audit_log').update({ actor_id: null }).eq('actor_id', userId),
          supabase.from('app_settings').update({ updated_by: null }).eq('updated_by', userId),
        ]);
        const { error: pErr } = await supabase.from('profiles').delete().eq('id', userId);
        if (!pErr) {
          await reload();
          setUsers((prev) => prev.filter((u) => u.id !== userId));
          return { success: true };
        }
        console.warn('Direct profile delete error:', pErr);
      } catch (e) {
        console.warn('Fallback direct delete exception:', e);
      }

      // If backend deletion completely failed, reload to restore the actual state
      await reload();
      return {
        success: false,
        error: rpcErr?.message || fnErr?.message || 'Database error: Please run migration 0038 in Supabase SQL Editor.',
      };
    }
    return { success: true };
  };

  const listDisbursementPersons = async (accountId?: string): Promise<DisbursementPerson[]> => {
    if (live) {
      const { data, error } = await supabase.rpc('list_disbursement_persons', {
        p_account_id: accountId || null,
      });
      if (error) throw error;
      return (data as DisbursementPerson[]) || [];
    }
    return mockPersons.filter((p) => !accountId || p.account_id === accountId);
  };

  const addDisbursementPerson = async (
    accountId: string,
    name: string,
    passkey: string
  ): Promise<Result & { id?: string }> => {
    if (live) {
      const { data, error } = await supabase.rpc('add_disbursement_person', {
        p_account_id: accountId,
        p_name: name,
        p_passkey: passkey,
      });
      if (error) return { success: false, error: errMsg(error) };
      return { success: true, id: (data as any)?.id };
    }
    if (!/^\d{4}$/.test(passkey)) return { success: false, error: 'Passkey must be exactly 4 digits' };
    const id = `person-${Date.now()}`;
    mockPersons.push({
      id,
      account_id: accountId,
      person_name: name.trim(),
      is_active: true,
      created_at: new Date().toISOString(),
    });
    return { success: true, id };
  };

  const updateDisbursementPerson = async (
    personId: string,
    name?: string,
    passkey?: string,
    isActive?: boolean
  ): Promise<Result> => {
    if (live) {
      const { error } = await supabase.rpc('update_disbursement_person', {
        p_person_id: personId,
        p_name: name || null,
        p_passkey: passkey || null,
        p_is_active: isActive !== undefined ? isActive : null,
      });
      if (error) return { success: false, error: errMsg(error) };
      return { success: true };
    }
    const idx = mockPersons.findIndex((p) => p.id === personId);
    if (idx !== -1) {
      if (name) mockPersons[idx].person_name = name.trim();
      if (isActive !== undefined) mockPersons[idx].is_active = isActive;
    }
    return { success: true };
  };

  const getMyDisbursementPersonCount = async (): Promise<number> => {
    if (live) {
      const { data, error } = await supabase.rpc('my_disbursement_person_count');
      if (error) return 0;
      return Number(data ?? 0);
    }
    return user ? mockPersons.filter((p) => p.account_id === user.id && p.is_active).length : 0;
  };

  return {
    departments, shops, regions, users, categories, productCategories, loading, live, reload, saveDepartment, saveShop, saveRegion, setRegionActive,
    saveProductCategory, setProductCategoryActive,
    createUser, updateAccess, setUserRegion, setDisbursementType, setPaymentDealerConfig, setHeadMandatoryConsultation, saveCategory, setDiscountReportAccess, setStockTransferReportAccess, setExhibitionWaitlistAccess, resetPassword, setActive,
    uploadCredential, setPhoto, removePhoto, updateUserDetails, checkCanDeleteUser, deleteUser,
    listDisbursementPersons, addDisbursementPerson, updateDisbursementPerson, getMyDisbursementPersonCount,
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
  return error ? { success: false, error: errMsg(error) } : { success: true };
}

export { isEntryCheckingUser } from './formatters';

/** Reliably loads active Entry Only disbursement officers, using the dedicated RPC with fallbacks */
export async function fetchActiveEntryOfficers(live: boolean): Promise<Profile[]> {
  if (!live) {
    return MOCK_USERS.filter(
      (u) => u.role === 'disbursement' && u.disbursement_type === 'entry_only' && !isEntryCheckingUser(u) && u.is_active
    );
  }
  let officers: Profile[] = [];
  try {
    const { data: rpcOfficers, error: rpcErr } = await supabase.rpc('get_active_entry_only_users');
    if (!rpcErr && rpcOfficers && (rpcOfficers as Profile[]).length > 0) {
      officers = rpcOfficers as Profile[];
    }
  } catch {
    // fallback to direct table query
  }
  if (officers.length === 0) {
    try {
      const { data: directProfiles } = await supabase
        .from('profiles')
        .select('id, username, full_name, designation, role, disbursement_type, is_active')
        .eq('role', 'disbursement')
        .eq('disbursement_type', 'entry_only')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (directProfiles && directProfiles.length > 0) {
        officers = directProfiles as Profile[];
      }
    } catch {
      // ignore
    }
  }
  return officers.filter((u) => !isEntryCheckingUser(u));
}

