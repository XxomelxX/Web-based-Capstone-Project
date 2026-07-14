import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * Use inside API routes to guard by role.
 * Example: const guard = await requireRole(['admin']); if (guard) return guard;
 */
export async function requireRole(allowedRoles: Array<'admin' | 'cashier'>) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 });
  }

  return null; // no error — caller proceeds
}
