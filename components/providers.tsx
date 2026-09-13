'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, unregisterServiceWorker, warmBrandCache, warmPagesCache, warmStaticAssets } from '@/lib/client/offline';
import { OnlineProvider } from '@/components/providers/online-provider';
import { initTheme } from '@/lib/client/hooks/useTheme';
import { Toaster } from 'sonner';

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
    warmStaticAssets();
  }, []);

  return (
    <SessionProvider refetchOnWindowFocus={false} refetchWhenOffline={false}>
      <OnlineProvider>
        <Toaster position="top-right" richColors closeButton duration={4000} />
        {children}
      </OnlineProvider>
    </SessionProvider>
  );
}
