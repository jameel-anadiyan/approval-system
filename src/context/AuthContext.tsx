import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Profile, AppRole } from '../types/database';
import { supabase, LOGIN_DOMAIN, checkSupabaseConnection } from '../lib/supabase';
import { MOCK_USERS } from '../lib/mockData';
import { isEntryCheckingUser } from '../lib/formatters';

interface AuthContextType {
  user: Profile | null;
  role: AppRole | null;
  isLoading: boolean;
  /** true = live Supabase; false = offline sandbox with demo data */
  isBackendConnected: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  /** Sandbox only: switch demo persona. No-op when connected to Supabase. */
  switchMockRole: (role: AppRole) => void;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SANDBOX_USER_KEY = 'approval_app_sandbox_user';
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, department:departments(*), shop:shops(*), region:regions(*)')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;

  let connectedEntries: { entry_user_id: string }[] = [];
  if (data.role === 'disbursement') {
    if (isEntryCheckingUser(data)) {
      data.disbursement_type = 'entry_approver';
    } else if (data.disbursement_type === 'payment_only') {
      try {
        const { data: mappings } = await supabase
          .from('payment_entry_account_mappings')
          .select('entry_user_id')
          .eq('payment_user_id', userId);
        if (mappings && mappings.length > 0) {
          connectedEntries = mappings as { entry_user_id: string }[];
        }
      } catch {
        /* ignore */
      }
    }
  }

  return {
    ...data,
    connected_entry_accounts: connectedEntries,
  } as Profile;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackendConnected, setIsBackendConnected] = useState(false);

  // One-time init: decide live vs sandbox, then restore the session for that mode.
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const onSync = (e: Event) => {
      const custom = e as CustomEvent<Profile>;
      if (custom.detail && mounted) {
        setUser(custom.detail);
      }
    };
    window.addEventListener('approval_app_user_sync', onSync);

    (async () => {
      try {
        const conn = await checkSupabaseConnection();
        if (!mounted) return;
        setIsBackendConnected(conn.connected);

        if (conn.connected) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const profile = await loadProfile(session.user.id);
            if (mounted) setUser(profile && profile.is_active ? profile : null);
            if (!profile || !profile.is_active) await supabase.auth.signOut();
          }
          const { data } = supabase.auth.onAuthStateChange((event, s) => {
            if (event === 'SIGNED_OUT' || !s?.user) {
              if (mounted) setUser(null);
            }
          });
          unsubscribe = () => data.subscription.unsubscribe();
        } else {
          const saved = localStorage.getItem(SANDBOX_USER_KEY);
          if (saved) {
            try {
              const parsed = JSON.parse(saved) as Profile;
              const matched = MOCK_USERS.find((u) => u.id === parsed.id || u.username === parsed.username);
              const fresh: Profile = matched
                ? {
                    ...matched,
                    ...parsed,
                    can_view_exhibition_waitlist:
                      parsed.can_view_exhibition_waitlist !== undefined
                        ? parsed.can_view_exhibition_waitlist
                        : matched.can_view_exhibition_waitlist,
                    can_view_discount_report:
                      parsed.can_view_discount_report !== undefined
                        ? parsed.can_view_discount_report
                        : matched.can_view_discount_report,
                    region_id: parsed.region_id ?? matched.region_id,
                    allowed_types: parsed.allowed_types ?? matched.allowed_types,
                  }
                : parsed;

              if (fresh.role === 'admin') {
                fresh.can_view_exhibition_waitlist = true;
                fresh.can_view_discount_report = true;
              }
              if (fresh.username === 'head_fin' && fresh.can_view_exhibition_waitlist === undefined) {
                fresh.can_view_exhibition_waitlist = true;
              }
              if (mounted) setUser(fresh);
              localStorage.setItem(SANDBOX_USER_KEY, JSON.stringify(fresh));
            } catch {
              localStorage.removeItem(SANDBOX_USER_KEY);
            }
          }
        }
      } catch (err) {
        console.error('Failed to initialize auth:', err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
      window.removeEventListener('approval_app_user_sync', onSync);
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user || !isBackendConnected) return;
    const updated = await loadProfile(user.id);
    if (updated) setUser(updated);
  }, [user, isBackendConnected]);

  const setSandboxUser = (p: Profile | null) => {
    setUser(p);
    if (p) localStorage.setItem(SANDBOX_USER_KEY, JSON.stringify(p));
    else localStorage.removeItem(SANDBOX_USER_KEY);
  };

  const login = async (username: string, password: string) => {
    const clean = username.trim().toLowerCase();
    if (!USERNAME_RE.test(clean)) {
      return { success: false, error: 'Enter a valid username (3–30 lowercase letters, digits, . _ -).' };
    }

    if (isBackendConnected) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: `${clean}@${LOGIN_DOMAIN}`,
        password,
      });
      if (error || !data.user) {
        // Don't reveal whether the username exists
        return { success: false, error: 'Wrong username or password.' };
      }
      const profile = await loadProfile(data.user.id);
      if (!profile || !profile.is_active) {
        await supabase.auth.signOut();
        return { success: false, error: 'This account is not active. Contact your administrator.' };
      }
      setUser(profile);
      return { success: true };
    }

    // Offline sandbox: demo personas only (no password check — demo data, not real auth)
    const matched = MOCK_USERS.find((u) => u.username === clean);
    if (!matched) {
      return { success: false, error: 'Sandbox mode: use a demo user (admin, head_fin, clerk_fin, emp_ravi, disb_anil).' };
    }
    setSandboxUser(matched);
    return { success: true };
  };

  const logout = async () => {
    if (isBackendConnected) await supabase.auth.signOut();
    setSandboxUser(null);
  };

  const switchMockRole = (role: AppRole) => {
    if (isBackendConnected) return;
    const found = MOCK_USERS.find((u) => u.role === role);
    if (found) {
      const fresh: Profile = { ...found };
      if (fresh.role === 'admin') {
        fresh.can_view_exhibition_waitlist = true;
        fresh.can_view_discount_report = true;
      }
      setSandboxUser(fresh);
    }
  };

  const updatePassword = async (newPassword: string) => {
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return { success: false, error: 'Password must be at least 8 characters with letters and digits.' };
    }
    if (isBackendConnected) {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      // Profiles have no client update policy; the RPC clears the flag for the caller only.
      const { error: rpcErr } = await supabase.rpc('password_changed');
      if (rpcErr) return { success: false, error: rpcErr.message };
      if (user) setUser({ ...user, must_change_password: false });
      return { success: true };
    }
    if (user) setSandboxUser({ ...user, must_change_password: false });
    return { success: true };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role ?? null,
        isLoading,
        isBackendConnected,
        login,
        logout,
        switchMockRole,
        updatePassword,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
