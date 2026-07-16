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
    const source = new EventSource('/api/realtime');

    const handleEvent = (event: MessageEvent, channel: RealtimeChannel) => {
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
      'itemlog',
      'lowstock',
      'reports',
      'restock',
    ];

    for (const eventName of eventNames) {
      source.addEventListener(eventName, (event) => handleEvent(event as MessageEvent, eventName));
    }

    source.addEventListener('keep-alive', () => {
      // keep the connection alive
    });

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, []);
}
