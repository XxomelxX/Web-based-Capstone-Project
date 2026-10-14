'use client';

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@/lib/server/realtime';

export type RealtimeHandlers = Partial<Record<RealtimeChannel, (payload: unknown) => void>>;

export function useRealtime(handlers: RealtimeHandlers) {
  const handlersRef = useRef<RealtimeHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NEXT_PUBLIC_DISABLE_REALTIME === 'true') return;
    if (!('EventSource' in window)) return;

    let currentSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;
    let reconnectDelay = 1000;

    const eventNames: RealtimeChannel[] = [
      'products', 'categories', 'settings', 'transactions',
      'utang', 'expenses', 'users', 'customers',
      'itemlog', 'lowstock', 'reports', 'restock',
    ];

    const handleEvent = (event: MessageEvent, channel: RealtimeChannel) => {
      reconnectDelay = 1000;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const currentHandler = handlersRef.current[channel];
      if (!currentHandler) return;
      try {
        currentHandler(JSON.parse(event.data));
      } catch {
        currentHandler(event.data);
      }
    };

    function attachListeners(src: EventSource) {
      for (const eventName of eventNames) {
        src.addEventListener(eventName, (event) => handleEvent(event as MessageEvent, eventName));
      }
      src.addEventListener('keep-alive', () => { reconnectDelay = 1000; });
    }

    function connect() {
      if (unmounted || currentSource) return;
      const src = new EventSource('/api/realtime');
      currentSource = src;
      attachListeners(src);

      src.onerror = () => {
        src.close();
        if (currentSource === src) currentSource = null;
        if (unmounted) return;
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          // The 'online' handler may have reconnected already; don't stack streams.
          if (typeof navigator !== 'undefined' && !navigator.onLine) return;
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      };
    }

    // Offline: close the stream and stop the reconnect loop. Every retry is a
    // doomed request (the SW answers it from cache/fallback), and they kept
    // firing while the register was supposed to be busy selling. 'online'
    // brings the stream back.
    function handleOffline() {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (currentSource) {
        currentSource.close();
        currentSource = null;
      }
    }

    function handleOnline() {
      if (unmounted || currentSource) return;
      // Take over from any pending backoff timer so we don't open two streams.
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      reconnectDelay = 1000;
      connect();
    }

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    connect();

    return () => {
      unmounted = true;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (currentSource) currentSource.close();
    };
  }, []);
}
