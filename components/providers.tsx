'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, unregisterServiceWorker } from '@/lib/offline';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      void unregisterServiceWorker();
      return;
    }
    installOfflineSync();
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
