import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AppNotification } from '../types/database';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { MOCK_NOTIFICATIONS } from '../lib/mockData';

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isBackendConnected } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const loadNotifications = useCallback(async () => {
    if (!user) return;

    if (isBackendConnected) {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30);

        if (!error && data) {
          setNotifications(data as AppNotification[]);
          return;
        }
      } catch {
        // fallback to mock
      }
    }

    // Filter mock notifications for current user or show relevant role notifications
    const userNotifs = MOCK_NOTIFICATIONS.filter((n) => n.user_id === user.id);
    setNotifications(userNotifs.length > 0 ? userNotifs : MOCK_NOTIFICATIONS.slice(0, 3));
  }, [user, isBackendConnected]);

  useEffect(() => {
    loadNotifications();

    if (!user || !isBackendConnected) return;

    // Supabase Realtime subscription on notifications table
    const channel = supabase
      .channel(`public:notifications:user_id=eq.${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as AppNotification;
          setNotifications((prev) => [newNotif, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isBackendConnected, loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const markAsRead = async (id: string) => {
    const now = new Date().toISOString();
    if (isBackendConnected) {
      try {
        await supabase.from('notifications').update({ read_at: now }).eq('id', id);
      } catch {
        // ignore
      }
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: now } : n))
    );
  };

  const markAllAsRead = async () => {
    const now = new Date().toISOString();
    if (user && isBackendConnected) {
      try {
        await supabase
          .from('notifications')
          .update({ read_at: now })
          .eq('user_id', user.id)
          .is('read_at', null);
      } catch {
        // ignore
      }
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: now })));
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        clearNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
