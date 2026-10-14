'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { readIdentity, saveIdentity, type StoredIdentity } from '@/lib/client/identity';

export interface CurrentUser {
  id: number | string;
  name: string;
  role: 'admin' | 'cashier' | string;
  username?: string;
  isOfflineSession?: boolean;
}

function fromIdentity(identity: StoredIdentity | null): CurrentUser | null {
  if (!identity) return null;
  return {
    id: identity.id,
    name: identity.name,
    role: identity.role,
    username: identity.username,
    isOfflineSession: true,
  };
}

export function useCurrentUser(): { user: CurrentUser | null; status: 'loading' | 'authenticated' | 'unauthenticated' } {
  const { data: session, status: sessionStatus } = useSession();
  // sessionStorage doesn't exist during SSR/prerender, and reading storage during
  // the first client render produces HTML that differs from the server (hydration
  // mismatch). Defer ALL user resolution until after mount so the first client
  // render is identical to the server render (user: null).
  //
  // Resolution order after mount:
  //   1. real NextAuth session (online)
  //   2. durable localStorage identity written on the last successful load
  //      (offline / reload / new tab / browser restart)
  //   3. legacy per-tab sessionStorage record (older builds)
  const [mounted, setMounted] = useState(false);
  const [offlineUser, setOfflineUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    setMounted(true);
    setOfflineUser(fromIdentity(readIdentity()));
  }, []);

  useEffect(() => {
    // Persist the real session so the next offline load still knows who this is.
    if (!session?.user) return;
    saveIdentity({
      id: session.user.id,
      name: session.user.name ?? '',
      role: session.user.role ?? '',
      username: (session.user as unknown as { username?: string }).username,
    });
  }, [session]);

  // CRITICAL: the returned `user` must be REFERENTIALLY STABLE across renders.
  // Before this, every render built a fresh `{ ... }` literal, so any consumer
  // effect keyed `}, [user])` fired on EVERY render — and POSClient's
  // [user]-keyed shift loader turned that into a fetch → setState → render
  // loop that pinned the main thread ("Page Unresponsive", only when a shift
  // was active). `session` (next-auth) and `offlineUser` (set once) are both
  // stable sources, so memoizing on them makes `user` change only when the
  // identity itself changes (login/logout/role switch).
  return useMemo(() => {
    if (!mounted) {
      return { user: null, status: 'loading' } as const;
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
        } as CurrentUser,
        status: 'authenticated',
      } as const;
    }

    // 2. Durable identity from the last session — keeps name/role offline.
    if (offlineUser) {
      return { user: offlineUser, status: 'authenticated' } as const;
    }

    return {
      user: null,
      status: sessionStatus === 'loading' ? 'loading' : 'unauthenticated',
    } as const;
  }, [mounted, session, sessionStatus, offlineUser]);
}
