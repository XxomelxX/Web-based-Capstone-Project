import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';

export async function GET() {
  const guard = await requireSession();
  if (guard) return guard;

  const settings = await prisma.settings.findFirst();
  const threshold = settings?.lowStockThreshold ?? 20;

  const products = await prisma.product.findMany({
    where: { archived: false, stock: { lt: threshold } },
    include: { category: true },
    orderBy: { stock: 'asc' },
  });

  return NextResponse.json({ threshold, products });
}
