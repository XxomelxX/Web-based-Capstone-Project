'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, unregisterServiceWorker, warmBrandCache, warmPagesCache, warmStaticAssets } from '@/lib/client/offline';
import { installOfflineNavigation } from '@/lib/client/offlineNavigation';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import { OnlineProvider } from '@/components/providers/online-provider';
import { initTheme } from '@/lib/client/hooks/useTheme';
import { readIdentity } from '@/lib/client/identity';
import { Toaster } from 'sonner';

function hasIdentity(): boolean {
  try {
    return readIdentity() !== null;
  } catch {
    return false;
  }
}

function warmOfflineCaches() {
  // Never warm pre-auth: unauthenticated fetches of module pages redirect to
  // /login, and caching those redirect documents under module keys poisons the
  // offline shells. The online/RECONNECT listeners re-enter this same gate.
  if (!hasIdentity()) return;
  warmPagesCache();
  warmBrandCache();
  warmStaticAssets();
}

let rewarmTimeout: ReturnType<typeof setTimeout> | null = null;

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initTheme();
    // Offline link clicks must be full document loads (cached shells), not
    // client-side RSC navigations whose ?_rsc=<hash> was never cached.
    installOfflineNavigation();
    if (process.env.NODE_ENV !== 'production') {
      void unregisterServiceWorker();
      return;
    }
    installOfflineSync();
    warmOfflineCaches();
    // Re-run warmers whenever connectivity returns: a precache/warmup that was
    // interrupted by going offline mid-download completes on the next online
    // window, so the following offline visit is fully styled.
    const rewarm = () => {
      if (rewarmTimeout) clearTimeout(rewarmTimeout);
      rewarmTimeout = setTimeout(warmOfflineCaches, 5000);
    };
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
