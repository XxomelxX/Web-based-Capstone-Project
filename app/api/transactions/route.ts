import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireSession } from '@/lib/server/require-session';

export async function GET(request: Request) {
  try {
    const guard = await requireSession();
    if (guard) return guard;

    // Unbounded finds × a ~400ms/RTT link to the DB made every orders-page
    // visit wait seconds. Cap at the latest 200 (optional ?limit= style,
    // verified against the orders UI) and trim joins to fields the Orders
    // UI actually renders.
    const { searchParams } = new URL(request.url);
    const asked = Number(searchParams.get('limit'));
    const take = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 2000) : 200;

    const transactions = await prisma.transaction.findMany({
      include: {
        items: { include: { product: { select: { name: true } } } },
        cashier: { select: { fullName: true } },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return NextResponse.json(transactions);
  } catch (err) {
    console.error('[GET /api/transactions]', err);
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
  }
}
