'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, registerServiceWorker, unregisterServiceWorker } from '@/lib/offline';
import { useOfflineSync } from '@/lib/useOfflineSync';

export function Providers({ children }: { children: React.ReactNode }) {
  useOfflineSync();

  useEffect(() => {
    const initServiceWorker = async () => {
      await unregisterServiceWorker();
      await registerServiceWorker();
      installOfflineSync();
    };

    initServiceWorker();
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
