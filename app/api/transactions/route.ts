import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const transactions = await prisma.transaction.findMany({
    include: { items: { include: { product: true } }, cashier: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(transactions);
}
