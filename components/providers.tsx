'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, unregisterServiceWorker, warmBrandCache, warmPagesCache, warmStaticAssets } from '@/lib/client/offline';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import { OnlineProvider } from '@/components/providers/online-provider';
import { initTheme } from '@/lib/client/hooks/useTheme';
import { Toaster } from 'sonner';

function warmOfflineCaches() {
  warmPagesCache();
  warmBrandCache();
  warmStaticAssets();
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initTheme();
    if (process.env.NODE_ENV !== 'production') {
      void unregisterServiceWorker();
      return;
    }
    installOfflineSync();
    warmOfflineCaches();
    // Re-run warmers whenever connectivity returns: a precache/warmup that was
    // interrupted by going offline mid-download completes on the next online
    // window, so the following offline visit is fully styled.
    const rewarm = () => warmOfflineCaches();
    window.addEventListener('online', rewarm);
    window.addEventListener(RECONNECT_EVENT_NAME, rewarm);
    return () => {
      window.removeEventListener('online', rewarm);
      window.removeEventListener(RECONNECT_EVENT_NAME, rewarm);
    };
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
