'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { installOfflineSync, registerServiceWorker } from '@/lib/offline';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    registerServiceWorker();
    installOfflineSync();
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
