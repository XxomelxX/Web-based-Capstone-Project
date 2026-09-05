import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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
