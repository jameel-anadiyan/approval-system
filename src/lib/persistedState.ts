import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const memoryStore = new Map<string, string>();
const STORAGE_PREFIX = 'approval_ui_state_v1';

function readStored<T>(fullKey: string, fallback: () => T): T {
  try {
    const raw =
      (typeof window !== 'undefined' ? window.sessionStorage.getItem(fullKey) : null) ??
      memoryStore.get(fullKey) ??
      null;
    if (raw !== null) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // Ignore storage / parse errors and use fallback
  }
  return fallback();
}

function writeStored<T>(fullKey: string, value: T): void {
  try {
    const serialized = JSON.stringify(value);
    memoryStore.set(fullKey, serialized);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(fullKey, serialized);
    }
  } catch {
    // Ignore storage quota / private browsing errors
  }
}

/**
 * Like `React.useState`, but persists the state in `sessionStorage` (scoped per logged-in user)
 * so filters, search queries, and selected sub-tabs survive navigating into `/requests/:id`
 * and returning via Back or sidebar/bottom-bar tabs.
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T | (() => T)
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const { user } = useAuth();
  const userScope = user?.id || 'anon';
  const fullKey = `${STORAGE_PREFIX}:${userScope}:${key}`;

  const getInitial = () =>
    typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;

  const [entry, setEntry] = useState<{ key: string; value: T }>(() => ({
    key: fullKey,
    value: readStored(fullKey, getInitial),
  }));

  const currentValue = entry.key === fullKey ? entry.value : readStored(fullKey, getInitial);

  useEffect(() => {
    if (entry.key !== fullKey) {
      setEntry({ key: fullKey, value: readStored(fullKey, getInitial) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey]);

  const latestRef = useRef({ key: fullKey, value: currentValue });
  latestRef.current = { key: fullKey, value: currentValue };

  const setValue: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (updater) => {
      const prev =
        latestRef.current.key === fullKey
          ? latestRef.current.value
          : readStored(fullKey, getInitial);
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      latestRef.current = { key: fullKey, value: next };
      writeStored(fullKey, next);
      setEntry({ key: fullKey, value: next });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullKey]
  );

  return [currentValue, setValue];
}
