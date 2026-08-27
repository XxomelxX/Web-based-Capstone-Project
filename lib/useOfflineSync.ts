'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFailedCount, getPendingCount, syncQueuedSales } from '@/lib/offlineQueue';

export const RECONNECT_EVENT_NAME = 'sari-pos-online-refresh';

export function triggerCategory2Refresh() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RECONNECT_EVENT_NAME));
  }
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(
    typeof window !== 'undefined' ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const [pending, failed] = await Promise.all([getPendingCount(), getFailedCount()]);
      setPendingCount(pending);
      setFailedCount(failed);
    } catch {
      // IndexedDB unavailable — ignore
    }
  }, []);

  const syncQueue = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    setSyncing(true);
    try {
      await syncQueuedSales();
      triggerCategory2Refresh();
    } finally {
      await refreshPendingCount();
      setSyncing(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);
    void refreshPendingCount();

    function handleOnline() {
      setIsOnline(true);
      void syncQueue();
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshPendingCount, syncQueue]);

  return {
    isOnline,
    pendingCount,
    failedCount,
    syncing,
    syncQueue,
    refreshPendingCount,
    // Back-compat aliases used by sidebar
    online: isOnline,
    queuedCount: pendingCount,
  };
}
