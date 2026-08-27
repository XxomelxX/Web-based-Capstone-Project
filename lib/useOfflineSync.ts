'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFailedCount, getPendingCount, syncQueuedSales } from '@/lib/offlineQueue';

export const RECONNECT_EVENT_NAME = 'sari-pos-online-refresh';
export const QUEUE_UPDATE_EVENT_NAME = 'sari-pos-queue-updated';

export function triggerCategory2Refresh() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RECONNECT_EVENT_NAME));
  }
}

export function triggerQueueUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(QUEUE_UPDATE_EVENT_NAME));
  }
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(
    typeof window !== 'undefined' ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const checkActualConnectivity = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    if (!navigator.onLine) {
      setIsOnline(false);
      return false;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const reachable = res.ok;
      setIsOnline(reachable);
      return reachable;
    } catch {
      setIsOnline(false);
      return false;
    }
  }, []);

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
    if (typeof window === 'undefined') return;
    const reachable = await checkActualConnectivity();
    if (!reachable) return;

    setSyncing(true);
    try {
      await syncQueuedSales();
      triggerCategory2Refresh();
    } finally {
      await refreshPendingCount();
      setSyncing(false);
    }
  }, [checkActualConnectivity, refreshPendingCount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    void checkActualConnectivity();
    void refreshPendingCount();

    function handleOnline() {
      console.log('EVENT: browser online');
      void checkActualConnectivity().then((online) => {
        if (online) void syncQueue();
      });
    }

    function handleOffline() {
      console.log('EVENT: browser offline');
      setIsOnline(false);
    }

    function handleQueueChange() {
      void refreshPendingCount();
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(QUEUE_UPDATE_EVENT_NAME, handleQueueChange);

    // Active heartbeat check every 6 seconds to catch OS network adapter false positives
    const interval = setInterval(() => {
      void checkActualConnectivity();
    }, 6000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(QUEUE_UPDATE_EVENT_NAME, handleQueueChange);
      clearInterval(interval);
    };
  }, [checkActualConnectivity, refreshPendingCount, syncQueue]);

  return {
    isOnline,
    pendingCount,
    failedCount,
    syncing,
    syncQueue,
    refreshPendingCount,
    checkActualConnectivity,
    // Back-compat aliases used by sidebar
    online: isOnline,
    queuedCount: pendingCount,
  };
}

export function useOnlineStatus() {
  const { isOnline } = useOfflineSync();
  return isOnline;
}
