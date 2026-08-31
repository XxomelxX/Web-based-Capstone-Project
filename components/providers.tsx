'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, unregisterServiceWorker } from '@/lib/offline';
import { initTheme } from '@/lib/useTheme';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initTheme();
    if (process.env.NODE_ENV !== 'production') {
      void unregisterServiceWorker();
      return;
    }
    installOfflineSync();
  }, []);

  return (
    <SessionProvider refetchOnWindowFocus={false} refetchWhenOffline={false}>
      {children}
    </SessionProvider>
  );
}
