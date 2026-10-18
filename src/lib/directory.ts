// Directory & admin operations. Live mode goes through RLS-guarded reads, the
// save_department / update_setting RPCs, and the admin-users / credentials Edge
// Functions (which hold the service key). Offline sandbox uses demo data.
import { useCallback, useEffect, useState } from 'react';
import { supabase, invokeEdgeFunction } from './supabase';
import { useAuth } from '../context/AuthContext';
import { MOCK_DEPARTMENTS, MOCK_USERS, MOCK_AUDIT_LOGS, MOCK_SETTINGS } from './mockData';
import type { AppRole, AuditLogEntry, Department, Profile } from '../types/database';

type Result = { success: boolean; error?: string };

export interface NewUserInput {
  username: string;
  full_name: string;
  designation?: string;
  role: AppRole;
  department_id?: string | null;
  password?: string;
  phone?: string;
}

export function useDirectory() {
  const { isBackendConnected, user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    if (isBackendConnected && user) {
      const [d, p] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('profiles').select('*, department:departments(*)').order('created_at', { ascending: false }),
      ]);
      setDepartments((d.data as Department[]) ?? []);
      setUsers((p.data as Profile[]) ?? []);
    } else {
      setDepartments(MOCK_DEPARTMENTS);
      setUsers(MOCK_USERS);
    }
    setLoading(false);
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

  const createUser = async (input: NewUserInput): Promise<Result> => {
    if (live) {
      const { error } = await invokeEdgeFunction('admin-users', { action: 'create', ...input });
      if (error) return { success: false, error: error.message };
      await reload();
      return { success: true };
    }
    const dept = departments.find((d) => d.id === input.department_id);
    setUsers((prev) => [{
      id: `user-${Date.now()}`, username: input.username, full_name: input.full_name,
      designation: input.designation ?? null, role: input.role, department_id: input.department_id ?? null,
      is_active: true, must_change_password: true, phone: input.phone ?? null, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), department: dept,
    }, ...prev]);
    return { success: true };
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

  return { departments, users, loading, live, reload, saveDepartment, createUser, resetPassword, setActive, uploadCredential };
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

/** Save a WhatsApp number (self, Admin for anyone, Head for own clerks/employees). Empty clears it. */
export async function setPhone(live: boolean, userId: string, phone: string): Promise<Result & { phone?: string | null }> {
  if (!live) return { success: true, phone: phone || null };
  const { data, error } = await supabase.rpc('set_phone', { p_user_id: userId, p_phone: phone });
  return error ? { success: false, error: error.message } : { success: true, phone: (data as string | null) ?? null };
}

/** Admin only: send a WhatsApp test message through Twilio. */
export async function sendWhatsAppTest(phone: string): Promise<Result> {
  const { error } = await invokeEdgeFunction('whatsapp-notify', { action: 'test', phone });
  return error ? { success: false, error: error.message } : { success: true };
}
