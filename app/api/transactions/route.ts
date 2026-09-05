import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';

export async function GET() {
  const guard = await requireSession();
  if (guard) return guard;

  const transactions = await prisma.transaction.findMany({
    include: { items: { include: { product: true } }, cashier: true, customer: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(transactions);
}
