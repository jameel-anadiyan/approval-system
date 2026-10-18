import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Profile, AppRole } from '../types/database';
import { supabase, LOGIN_DOMAIN, checkSupabaseConnection } from '../lib/supabase';
import { MOCK_USERS } from '../lib/mockData';

interface AuthContextType {
  user: Profile | null;
  role: AppRole | null;
  isLoading: boolean;
  isBackendConnected: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchMockRole: (role: AppRole) => void;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_USER_KEY = 'approval_app_active_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);

  const loadUserProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, department:departments(*)')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data) return null;
      return data as Profile;
    } catch {
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    if (isBackendConnected) {
      const updated = await loadUserProfile(user.id);
      if (updated) setUser(updated);
    }
  }, [user, isBackendConnected, loadUserProfile]);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      setIsLoading(true);
      const conn = await checkSupabaseConnection();
      if (!mounted) return;
      setIsBackendConnected(conn.connected);

      if (conn.connected) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const profile = await loadUserProfile(session.user.id);
          if (profile && mounted) {
            setUser(profile);
            setIsLoading(false);
            return;
          }
        }
      }

      // Check local storage for persistent mock session or default to Admin for easy testing
      const savedUserStr = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
      if (savedUserStr) {
        try {
          const savedUser = JSON.parse(savedUserStr);
          if (savedUser && mounted) {
            setUser(savedUser);
            setIsLoading(false);
            return;
          }
        } catch {
          // ignore corrupted JSON
        }
      }

      // Default initial mock user for quick exploration: Admin
      if (mounted) {
        const defaultUser = MOCK_USERS[0];
        setUser(defaultUser);
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(defaultUser));
        setIsLoading(false);
      }
    }

    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user && isBackendConnected) {
        const profile = await loadUserProfile(session.user.id);
        if (profile && mounted) setUser(profile);
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [isBackendConnected, loadUserProfile]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const cleanUsername = username.trim().toLowerCase();

    if (isBackendConnected) {
      const email = `${cleanUsername}@${LOGIN_DOMAIN}`;
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data.user) {
        const profile = await loadUserProfile(data.user.id);
        if (!profile) {
          return { success: false, error: 'User profile not found. Please contact Administrator.' };
        }
        if (!profile.is_active) {
          await supabase.auth.signOut();
          return { success: false, error: 'This account has been deactivated.' };
        }
        setUser(profile);
        localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(profile));
        return { success: true };
      }
    }

    // Mock login fallback
    const matched = MOCK_USERS.find((u) => u.username.toLowerCase() === cleanUsername);
    if (matched) {
      if (!matched.is_active) {
        return { success: false, error: 'This account has been deactivated.' };
      }
      setUser(matched);
      localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(matched));
      return { success: true };
    }

    return { success: false, error: 'Invalid username or password. (Demo: try admin, head_fin, clerk_fin, emp_ravi, or disb_anil)' };
  };

  const logout = async () => {
    if (isBackendConnected) {
      await supabase.auth.signOut();
    }
    setUser(null);
    localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
  };

  const switchMockRole = (role: AppRole) => {
    const found = MOCK_USERS.find((u) => u.role === role);
    if (found) {
      setUser(found);
      localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(found));
    }
  };

  const updatePassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    if (newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long.' };
    }

    if (isBackendConnected) {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };

      if (user) {
        await supabase
          .from('profiles')
          .update({ must_change_password: false, updated_at: new Date().toISOString() })
          .eq('id', user.id);
      }
    }

    if (user) {
      const updated = { ...user, must_change_password: false };
      setUser(updated);
      localStorage.setItem(LOCAL_STORAGE_USER_KEY, JSON.stringify(updated));
    }

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
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
