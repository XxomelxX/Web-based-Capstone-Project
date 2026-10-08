import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireSession } from '@/lib/server/require-session';

export async function GET() {
  try {
    const guard = await requireSession();
    if (guard) return guard;

    const transactions = await prisma.transaction.findMany({
      include: { items: { include: { product: true } }, cashier: true, customer: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(transactions);
  } catch (err) {
    console.error('[GET /api/transactions]', err);
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
  }
}
