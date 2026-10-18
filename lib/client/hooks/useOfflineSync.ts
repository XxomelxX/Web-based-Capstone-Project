'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFailedCount, getPendingCount, syncQueuedSales } from '@/lib/client/offlineQueue';

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

    // Deferred: checkActualConnectivity's first setIsOnline runs before its
    // first await, and synchronous set-state in the effect body is what the
    // cascading-render rule forbids.
    const boot = setTimeout(() => {
      void checkActualConnectivity();
      void refreshPendingCount();
    }, 0);

    let drainTimer: ReturnType<typeof setTimeout> | undefined;

    // Auto-drain: an action queued while ONLINE used to wait for the next
    // window 'online' event (possibly forever on a stable connection) — the
    // user saw a stuck "Online (1 queued)" pill after opening a shift that
    // fell back to the queue. Drain when pending>0 and the health check
    // passes; costs nothing while the queue is empty.
    const maybeDrainQueue = async () => {
      try {
        const pending = await getPendingCount();
        if (pending > 0 && navigator.onLine) await syncQueue();
      } catch {
        // IndexedDB unavailable or transient error — retry on next trigger
      }
    };

    function handleOnline() {
      void checkActualConnectivity().then((online) => {
        if (online) void syncQueue();
      });
    }

    function handleOffline() {
      setIsOnline(false);
    }

    function handleQueueChange() {
      void refreshPendingCount();
      // Coalesce enqueue bursts (a checkout can queue several rows) into one
      // sync a moment later instead of one push per row.
      if (drainTimer) clearTimeout(drainTimer);
      drainTimer = setTimeout(() => { void maybeDrainQueue(); }, 1500);
    }

    // Safety net: eventual drain even if no event fires (e.g. an action that
    // failed transiently, or the mount-drain racing a cold server).
    const drainInterval = setInterval(() => { void maybeDrainQueue(); }, 60000);
    // Drain leftovers from a previous session ~3s after boot.
    const mountDrain = setTimeout(() => { void maybeDrainQueue(); }, 3000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(QUEUE_UPDATE_EVENT_NAME, handleQueueChange);

    return () => {
      clearTimeout(boot);
      if (drainTimer) clearTimeout(drainTimer);
      clearInterval(drainInterval);
      clearTimeout(mountDrain);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(QUEUE_UPDATE_EVENT_NAME, handleQueueChange);
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
