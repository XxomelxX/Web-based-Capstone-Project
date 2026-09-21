'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';

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
  const [offlineUser] = useState<CurrentUser | null>(readOfflineSession);

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

  // 2. Fall back to local offline session storage (available on first render)
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
