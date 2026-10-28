import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

/**
 * Unique identifier for the current browser tab / computer session.
 * Stored in sessionStorage so multiple tabs/computers with the same login credentials
 * have distinct session IDs.
 */
export function getClientSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  const key = 'entry_client_session_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function getClientSessionLabel(): string {
  if (typeof window === 'undefined') return 'Session';
  const key = 'entry_client_session_label';
  let label = sessionStorage.getItem(key);
  if (!label) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    label = `Computer Session (${timeStr})`;
    sessionStorage.setItem(key, label);
  }
  return label;
}

export interface EntryLockState {
  isLockedByMe: boolean;
  isLockedByOther: boolean;
  lockedByName?: string;
  clientLabel?: string;
  lockedAt?: string;
  loading: boolean;
  error?: string | null;
}

/**
 * Hook to manage concurrent session locks for entry-only users.
 * When enabled, acquires the lock on the given request and keeps it alive via heartbeats.
 * Releases the lock on unmount or navigation.
 */
export function useEntryLock(requestId: string | undefined | null, enabled: boolean) {
  const { isBackendConnected } = useAuth();
  const [state, setState] = useState<EntryLockState>({
    isLockedByMe: false,
    isLockedByOther: false,
    loading: enabled && !!requestId,
  });

  const sessionIdRef = useRef<string>(getClientSessionId());
  const clientLabelRef = useRef<string>(getClientSessionLabel());
  const heartbeatTimerRef = useRef<any>(null);
  const pollTimerRef = useRef<any>(null);

  const releaseLock = useCallback(async () => {
    if (!requestId || !isBackendConnected) return;
    try {
      await supabase.rpc('release_entry_lock', {
        p_request_id: requestId,
        p_session_id: sessionIdRef.current,
      });
    } catch {
      // ignore
    }
  }, [requestId, isBackendConnected]);

  const acquireLock = useCallback(async () => {
    if (!requestId || !enabled || !isBackendConnected) {
      setState({ isLockedByMe: false, isLockedByOther: false, loading: false });
      return;
    }

    try {
      const { data, error } = await supabase.rpc('acquire_entry_lock', {
        p_request_id: requestId,
        p_session_id: sessionIdRef.current,
        p_client_label: clientLabelRef.current,
      });

      if (error) {
        setState({
          isLockedByMe: false,
          isLockedByOther: false,
          loading: false,
          error: error.message,
        });
        return;
      }

      const res = data as any;
      if (res?.is_owner) {
        setState({
          isLockedByMe: true,
          isLockedByOther: false,
          loading: false,
          clientLabel: clientLabelRef.current,
        });
      } else if (res?.locked && !res?.is_owner) {
        setState({
          isLockedByMe: false,
          isLockedByOther: true,
          lockedByName: res.locked_by_name || 'Another session',
          clientLabel: res.client_label || 'Another computer',
          lockedAt: res.locked_at,
          loading: false,
        });
      } else {
        setState({ isLockedByMe: false, isLockedByOther: false, loading: false });
      }
    } catch (err: any) {
      setState({
        isLockedByMe: false,
        isLockedByOther: false,
        loading: false,
        error: err?.message || 'Could not check lock status',
      });
    }
  }, [requestId, enabled, isBackendConnected]);

  // Main lifecycle
  useEffect(() => {
    if (!enabled || !requestId || !isBackendConnected) {
      setState({ isLockedByMe: false, isLockedByOther: false, loading: false });
      return;
    }

    acquireLock();

    // Heartbeat every 15 seconds if locked by me
    heartbeatTimerRef.current = setInterval(async () => {
      if (!requestId || !isBackendConnected) return;
      try {
        const { data } = await supabase.rpc('heartbeat_entry_lock', {
          p_request_id: requestId,
          p_session_id: sessionIdRef.current,
        });
        if (data && !(data as any).success) {
          // Heartbeat failed or stolen; re-acquire
          acquireLock();
        }
      } catch {
        // ignore
      }
    }, 15000);

    // If locked by another computer, poll every 4 seconds to detect when they close it!
    pollTimerRef.current = setInterval(() => {
      acquireLock();
    }, 4000);

    const handleBeforeUnload = () => {
      releaseLock();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      releaseLock();
    };
  }, [enabled, requestId, isBackendConnected, acquireLock, releaseLock]);

  return {
    ...state,
    sessionId: sessionIdRef.current,
    refreshLock: acquireLock,
    releaseLock,
  };
}
