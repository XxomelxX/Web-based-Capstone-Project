import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { NextResponse } from 'next/server';

/**
 * Use inside API routes to require any authenticated session.
 * Example: const guard = await requireSession(); if (guard) return guard;
 */
export async function requireSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return null;
}

/**
 * Use inside API routes to require an admin session (e.g. /api/reports —
 * drawer totals must never be visible to cashiers, even by direct URL).
 * Returns the guard response, or null when the caller may proceed.
 */
export async function requireAdmin() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if ((session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  return null;
}
