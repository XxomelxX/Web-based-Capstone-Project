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

function readOfflineSession(): CurrentUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('offlineSession');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...parsed, isOfflineSession: true };
  } catch {
    return null;
  }
}

export function useCurrentUser(): { user: CurrentUser | null; status: 'loading' | 'authenticated' | 'unauthenticated' } {
  const { data: session, status: sessionStatus } = useSession();
  // sessionStorage doesn't exist during SSR/prerender, and reading it during the
  // first client render produces HTML that differs from the server (hydration
  // mismatch). Defer all user resolution until after mount so the first client
  // render is identical to the server render (user: null).
  const [mounted, setMounted] = useState(false);
  const [offlineUser, setOfflineUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    setMounted(true);
    setOfflineUser(readOfflineSession());
  }, []);

  if (!mounted) {
    return { user: null, status: 'loading' };
  }

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
  if (offlineUser) {
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
