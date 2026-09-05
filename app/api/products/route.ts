import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { requireSession } from '@/lib/require-session';
import { broadcastRealtime } from '@/lib/realtime';

export async function GET(request: Request) {
  const guard = await requireSession();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const showArchived = searchParams.get('archived') === 'true';

  const products = await prisma.product.findMany({
    where: { archived: showArchived },
    include: { category: true },
    orderBy: { name: 'asc' },
  });

  const productIds = products.map((p) => p.id);
  const [txCounts, utangCounts, batchCounts, logCounts] = await Promise.all([
    prisma.transactionItem.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
    prisma.utangEntryItem.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
    prisma.stockBatch.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
    prisma.itemLog.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
  ]);

  const txMap = new Map(txCounts.map((r) => [r.productId, r._count]));
  const utangMap = new Map(utangCounts.map((r) => [r.productId, r._count]));
  const batchMap = new Map(batchCounts.map((r) => [r.productId, r._count]));
  const logMap = new Map(logCounts.map((r) => [r.productId, r._count]));

  const productsWithHistory = products.map((p) => {
    const count = (txMap.get(p.id) ?? 0) + (utangMap.get(p.id) ?? 0) + (batchMap.get(p.id) ?? 0) + (logMap.get(p.id) ?? 0);
    return { ...p, _hasHistory: count > 0 };
  });

  return NextResponse.json(productsWithHistory);
}

export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const data = await request.json();

  if (!data.name || !data.categoryId || data.price == null || data.stock == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const product = await prisma.product.create({
    data: {
      name: data.name,
      categoryId: Number(data.categoryId),
      price: Number(data.price),
      cost: Number(data.cost ?? 0),
      stock: Number(data.stock),
      packSize: data.packSize ?? null,
      unit: data.unit ?? null,
      barcode: data.barcode ?? null,
      goodsType: data.goodsType ?? 'non-perishable',
      vatType: data.vatType ?? 'exempt',
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
    },
  });

  broadcastRealtime('products', { action: 'created', product });
  return NextResponse.json(product, { status: 201 });
}
