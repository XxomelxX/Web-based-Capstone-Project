import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const settings = await prisma.settings.findFirst();
  const threshold = settings?.lowStockThreshold ?? 20;

  const products = await prisma.product.findMany({
    where: { archived: false, stock: { lt: threshold } },
    include: { category: true },
    orderBy: { stock: 'asc' },
  });

  return NextResponse.json({ threshold, products });
}
