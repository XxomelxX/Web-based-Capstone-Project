import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';

// GET /api/sync/pull?since=ISO — delta sync (blog §9 pullChanges).
// Returns products (delta), categories (full), customers (full), settings (single).
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since');

  // Products: delta sync using updatedAt
  const productWhere = since ? { updatedAt: { gt: new Date(since) } } : {};
  const products = await prisma.product.findMany({ where: productWhere, take: 500, include: { category: true } });

  // Categories, Customers, Settings: always pull all (small tables, no updatedAt)
  const [categories, customers, settings, utang] = await Promise.all([
    prisma.category.findMany({ take: 200 }),
    prisma.customer.findMany({ take: 1000 }),
    prisma.settings.findFirst(),
    prisma.utangEntry.findMany({ take: 1000, include: { customer: true, items: true, paymentAllocations: true } }),
  ]);

  return NextResponse.json({
    products,
    categories,
    customers,
    utang,
    settings: settings ?? null,
    syncedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
