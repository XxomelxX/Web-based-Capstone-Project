'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { performSync, checkConnectivity, shouldRetry, getRetryDelay, incrementRetry, resetRetries, getRetryCount } from '@/lib/client/sync-engine';
import { getPendingCount, getFailedCount } from '@/lib/client/offlineQueue';
import { getLastSyncedAt } from '@/lib/client/offline';
import { toast } from 'sonner';
import { triggerCategory2Refresh } from '@/lib/client/hooks/useOfflineSync';

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

export function OnlineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [forceOffline, setForceOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const wasOfflineRef = useRef(false);

  const effectiveOnline = isOnline && !forceOffline;

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const ping = setInterval(async () => {
      if (!forceOffline) setIsOnline(await checkConnectivity());
    }, 30000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(ping); };
  }, [forceOffline]);

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
    return () => clearInterval(i);
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
