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
      if (unmounted) return;
      const src = new EventSource('/api/realtime');
      currentSource = src;
      attachListeners(src);

      src.onerror = () => {
        src.close();
        if (unmounted) return;
        reconnectTimeout = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (currentSource) currentSource.close();
    };
  }, []);
}
