'use client';

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@/lib/realtime';

export type RealtimeHandlers = Partial<Record<RealtimeChannel, (payload: unknown) => void>>;

export function useRealtime(handlers: RealtimeHandlers) {
  const handlersRef = useRef<RealtimeHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    // Allow disabling realtime via env var for environments that don't support long-lived SSE.
    // Vercel edge functions do not support long-lived SSE connections reliably.
    if (typeof window === 'undefined') return;
    if (process.env.NEXT_PUBLIC_DISABLE_REALTIME === 'true') return;
    if (!('EventSource' in window)) return;

    const source = new EventSource('/api/realtime');
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;

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

    const eventNames: RealtimeChannel[] = [
      'products',
      'categories',
      'settings',
      'transactions',
      'utang',
      'expenses',
      'users',
      'customers',
      'itemlog',
      'lowstock',
      'reports',
      'restock',
    ];

    for (const eventName of eventNames) {
      source.addEventListener(eventName, (event) => handleEvent(event as MessageEvent, eventName));
    }

    source.addEventListener('keep-alive', () => {
      reconnectDelay = 1000;
    });

    source.onerror = () => {
      source.close();
      reconnectTimeout = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        source.close();
        const newSource = new EventSource('/api/realtime');
        for (const eventName of eventNames) {
          newSource.addEventListener(eventName, (event) => handleEvent(event as MessageEvent, eventName));
        }
        newSource.addEventListener('keep-alive', () => {
          reconnectDelay = 1000;
        });
      }, reconnectDelay);
    };

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      source.close();
    };
  }, []);
}
