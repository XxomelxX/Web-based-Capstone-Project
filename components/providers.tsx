'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, unregisterServiceWorker, warmBrandCache, warmPagesCache } from '@/lib/client/offline';
import { OnlineProvider } from '@/components/providers/online-provider';
import { initTheme } from '@/lib/client/hooks/useTheme';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initTheme();
    if (process.env.NODE_ENV !== 'production') {
      void unregisterServiceWorker();
      return;
    }
    installOfflineSync();
    warmPagesCache();
    warmBrandCache();
  }, []);

  return (
    <SessionProvider refetchOnWindowFocus={false} refetchWhenOffline={false}>
      <OnlineProvider>{children}</OnlineProvider>
    </SessionProvider>
  );
}
