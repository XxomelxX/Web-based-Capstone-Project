'use client';

import { useEffect, useState } from 'react';
import {
  getPendingSalesCount,
  getSyncFailedCount,
  syncQueuedSales,
} from '@/lib/offlineQueue';

export function useOfflineSync() {
  const [online, setOnline] = useState(typeof window !== 'undefined' ? navigator.onLine : true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCounts = async () => {
    if (typeof window === 'undefined') return;
    setQueuedCount(await getPendingSalesCount());
    setFailedCount(await getSyncFailedCount());
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateOnlineStatus = () => setOnline(navigator.onLine);
    const handleSync = async () => {
      setSyncing(true);
      await syncQueuedSales();
      setSyncing(false);
      await refreshCounts();
    };

    window.addEventListener('online', handleSync);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    refreshCounts();
    if (navigator.onLine) {
      handleSync();
    }

    return () => {
      window.removeEventListener('online', handleSync);
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  return { online, queuedCount, failedCount, syncing };
}
