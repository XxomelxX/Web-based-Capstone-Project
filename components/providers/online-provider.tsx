'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { performSync, checkConnectivity, shouldRetry, getRetryDelay, incrementRetry, resetRetries, getRetryCount } from '@/lib/client/sync-engine';
import { getPendingCount, getFailedCount } from '@/lib/client/offlineQueue';
import { getLastSyncedAt } from '@/lib/client/offline';
import { toast } from 'sonner';
import { triggerCategory2Refresh, QUEUE_UPDATE_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';

interface OnlineContextType {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  retryCount: number;
  lastSyncedAt: string | null;
  forceOffline: boolean;
  setForceOffline: (v: boolean) => void;
  syncNow: () => Promise<void>;
}

const OnlineContext = createContext<OnlineContextType | undefined>(undefined);

const OFFLINE_CONFIRMATION_DELAY_MS = 10000;

export function OnlineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [forceOffline, setForceOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const wasOfflineRef = useRef(false);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveOnline = isOnline && !forceOffline;

  // 10s confirmation gate: going offline is delayed, coming back online is instant.
  const handleConnectivityResult = useCallback(
    (reachable: boolean) => {
      if (reachable) {
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        if (!forceOffline) setIsOnline(true);
        return;
      }
      if (forceOffline) return;
      if (!offlineTimerRef.current) {
        offlineTimerRef.current = setTimeout(() => {
          setIsOnline(false);
          offlineTimerRef.current = null;
        }, OFFLINE_CONFIRMATION_DELAY_MS);
      }
    },
    [forceOffline],
  );

  useEffect(() => {
    let cancelled = false;
    let pinging = false;
    const verify = async () => {
      if (pinging) return;
      pinging = true;
      try {
        const online = await checkConnectivity();
        if (!cancelled) handleConnectivityResult(online);
      } finally {
        pinging = false;
      }
    };
    // Verify real connectivity on mount — never trust initial `true`.
    // Route through the confirmation gate so a cold load with wifi off
    // also gets the 10s delay instead of flashing Offline instantly.
    if (!navigator.onLine) handleConnectivityResult(false);
    void verify();
    // Initial sync pull to populate Dexie cache on first load
    void (async () => {
      try {
        const { performSync } = await import('@/lib/client/sync-engine');
        await performSync();
      } catch { /* non-critical */ }
    })();
    // Browser says offline → start confirmation timer. Browser says online →
    // verify against /api/health before showing Online (captive portals
    // and dead routers still fire 'online').
    const on = () => {
      if (!navigator.onLine) {
        handleConnectivityResult(false);
        return;
      }
      void verify();
    };
    const off = () => handleConnectivityResult(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    // Re-verify whenever the user comes back to the tab — e.g. they turned
    // wifi off/on while looking at another window. No DevTools needed.
    window.addEventListener('focus', on);
    document.addEventListener('visibilitychange', on);
    const ping = setInterval(verify, 6000);
    return () => {
      cancelled = true;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('focus', on);
      document.removeEventListener('visibilitychange', on);
      clearInterval(ping);
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
    };
  }, [forceOffline, handleConnectivityResult]);

  useEffect(() => {
    const update = async () => {
      try {
        setPendingCount(await getPendingCount());
        setFailedCount(await getFailedCount());
        const synced = await getLastSyncedAt();
        if (synced) setLastSyncedAt(synced);
      } catch { /* dexie not ready */ }
    };
    update();
    const i = setInterval(update, 5000);
    window.addEventListener(QUEUE_UPDATE_EVENT_NAME, update);
    return () => {
      clearInterval(i);
      window.removeEventListener(QUEUE_UPDATE_EVENT_NAME, update);
    };
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current || !effectiveOnline) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const result = await performSync();
      if (result.success) {
        resetRetries();
        setPendingCount(await getPendingCount());
        setFailedCount(await getFailedCount());
        setLastSyncedAt(result.syncedAt);
        if (result.synced > 0) {
          toast.success(`Synced ${result.synced} action${result.synced !== 1 ? 's' : ''}`);
        }
        if (result.conflicts > 0) {
          toast.warning(`${result.conflicts} conflict${result.conflicts !== 1 ? 's' : ''} resolved (server-wins)`);
        }
        triggerCategory2Refresh();
      } else {
        throw new Error(result.error || 'Sync failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      if (shouldRetry()) {
        incrementRetry();
        const retryIn = getRetryDelay();
        toast.warning(`Sync failed, retrying in ${Math.round(retryIn / 1000)}s... (${getRetryCount()}/5)`);
        setTimeout(() => { syncingRef.current = false; void syncNow(); }, retryIn);
        setIsSyncing(false);
        return;
      } else {
        resetRetries();
        setForceOffline(true);
        toast.error(`Sync failed after 5 retries: ${msg}`);
      }
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [effectiveOnline]);

  useEffect(() => {
    if (effectiveOnline && wasOfflineRef.current) void syncNow();
    wasOfflineRef.current = !effectiveOnline;
  }, [effectiveOnline, syncNow]);

  return (
    <OnlineContext.Provider value={{ isOnline: effectiveOnline, isSyncing, pendingCount, failedCount, retryCount: getRetryCount(), lastSyncedAt, forceOffline, setForceOffline, syncNow }}>
      {children}
    </OnlineContext.Provider>
  );
}

export function useOnline() {
  const ctx = useContext(OnlineContext);
  if (!ctx) throw new Error('useOnline must be used within OnlineProvider');
  return ctx;
}
