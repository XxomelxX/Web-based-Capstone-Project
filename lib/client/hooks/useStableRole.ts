'use client';

import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@/lib/client/hooks/useCurrentUser';
import { readIdentity } from '@/lib/client/identity';

export type KnownRole = 'admin' | 'cashier';

function asKnownRole(role: unknown): KnownRole | null {
  return role === 'admin' || role === 'cashier' ? role : null;
}

/**
 * Role for navigation, with one guarantee: it NEVER downgrades to cashier.
 *
 * `const role = user?.role ?? 'cashier'` is what silently flipped an admin to
 * the cashier UI whenever `user` was null — on SSR before the session resolved,
 * and permanently offline once the per-tab session record was gone. Here the
 * role is read from the live session or the durable identity, latched on first
 * sight, and `null` (unknown) is answered by rendering no link set at all
 * rather than the wrong one.
 */
export function useStableRole(): KnownRole | null {
  const { user } = useCurrentUser();
  const [role, setRole] = useState<KnownRole | null>(null);
  const lastRoleRef = useRef<KnownRole | null>(null);

  const latch = (next: KnownRole | null) => {
    if (!next) return;
    if (lastRoleRef.current === next) return;
    lastRoleRef.current = next;
    setRole(next);
  };

  // Live session (or durable identity, resolved post-mount by useCurrentUser).
  useEffect(() => {
    latch(asKnownRole(user?.role));
  }, [user?.role]);

  // Fallback for the very first offline paint: durable identity is readable
  // synchronously on the client, so the nav never renders the wrong role set.
  useEffect(() => {
    if (lastRoleRef.current) return;
    latch(asKnownRole(readIdentity()?.role));
  }, []);

  return role;
}