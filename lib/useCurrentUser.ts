'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

export interface CurrentUser {
  id: number | string;
  name: string;
  role: 'admin' | 'cashier' | string;
  username?: string;
  isOfflineSession?: boolean;
}

export function useCurrentUser(): { user: CurrentUser | null; status: 'loading' | 'authenticated' | 'unauthenticated' } {
  const { data: session, status: sessionStatus } = useSession();
  const [offlineUser, setOfflineUser] = useState<CurrentUser | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const raw = sessionStorage.getItem('offlineSession');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setOfflineUser({ ...parsed, isOfflineSession: true });
        } catch {
          // ignore parsing error
        }
      }
    }
  }, []);

  // 1. Prefer real NextAuth session if available
  if (session?.user) {
    return {
      user: {
        id: session.user.id,
        name: session.user.name ?? '',
        role: session.user.role ?? 'cashier',
        username: (session.user as unknown as { username?: string }).username,
        isOfflineSession: false,
      },
      status: 'authenticated',
    };
  }

  // 2. Fall back to local offline session storage
  if (mounted && offlineUser) {
    return {
      user: offlineUser,
      status: 'authenticated',
    };
  }

  return {
    user: null,
    status: sessionStatus === 'loading' ? 'loading' : 'unauthenticated',
  };
}
