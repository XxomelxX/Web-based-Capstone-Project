import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireSession } from '@/lib/server/require-session';

const ACTIONS = ['sold', 'restocked', 'adjusted', 'voided'];

// GET /api/itemlog           — latest 200 stock movements
// GET /api/itemlog?action=adjusted — latest 200 stock adjustments only
export async function GET(request: Request) {
  const guard = await requireSession();
  if (guard) return guard;

  const action = new URL(request.url).searchParams.get('action');
  if (action && !ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Invalid action filter' }, { status: 400 });
  }

  const logs = await prisma.itemLog.findMany({
    where: action ? { action } : undefined,
    include: { product: true, user: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return NextResponse.json(logs);
}
