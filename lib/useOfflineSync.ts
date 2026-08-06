'use client';

import { useEffect, useState } from 'react';
import {
  getPendingSalesCount,
  getSyncFailedCount,
  syncQueuedSales,
} from '@/lib/offlineQueue';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof window !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleOnline() {
      console.log('Browser reports: back online');
      setIsOnline(true);
    }

    function handleOffline() {
      console.log('Browser reports: went offline');
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const timer = setInterval(() => {
      const current = navigator.onLine;
      setIsOnline((prev) => {
        if (prev !== current) {
          console.log(current ? 'Browser reports: back online' : 'Browser reports: went offline');
          return current;
        }
        return prev;
      });
    }, 1000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timer);
    };
  }, []);

  return isOnline;
}

export function useOfflineSync() {
  const [online, setOnline] = useState<boolean>(
    typeof window !== 'undefined' ? navigator.onLine : true
  );
  const [queuedCount, setQueuedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCounts = async () => {
    if (typeof window === 'undefined') return;
    try {
      setQueuedCount(await getPendingSalesCount());
      setFailedCount(await getSyncFailedCount());
    } catch {
      // ignore IndexedDB errors
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleSync = async () => {
      if (!navigator.onLine) return;
      setSyncing(true);
      try {
        await syncQueuedSales();
      } finally {
        setSyncing(false);
        await refreshCounts();
      }
    };

    const checkStatus = () => {
      const currentStatus = navigator.onLine;
      setOnline((prev) => {
        if (prev !== currentStatus) {
          if (currentStatus) {
            console.log('Browser reports: back online');
            handleSync();
          } else {
            console.log('Browser reports: went offline');
          }
          return currentStatus;
        }
        return prev;
      });
    };

    const handleOnline = () => {
      console.log('Browser reports: back online');
      setOnline(true);
      handleSync();
    };

    const handleOffline = () => {
      console.log('Browser reports: went offline');
      setOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const timer = setInterval(() => {
      checkStatus();
      void refreshCounts();
    }, 1000);

    void Promise.resolve().then(refreshCounts);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timer);
    };
  }, []);

  return { online, queuedCount, failedCount, syncing };
}
