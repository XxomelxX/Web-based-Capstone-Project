import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const showArchived = searchParams.get('archived') === 'true';

  const products = await prisma.product.findMany({
    where: { archived: showArchived },
    include: { category: true },
    orderBy: { name: 'asc' },
  });

  // For each product, check if it has linked history (for enabling/disabling delete)
  const productsWithHistory = await Promise.all(
    products.map(async (p) => {
      const [txItems, utangItems, stockBatches, itemLogs] = await Promise.all([
        prisma.transactionItem.count({ where: { productId: p.id } }),
        prisma.utangEntryItem.count({ where: { productId: p.id } }),
        prisma.stockBatch.count({ where: { productId: p.id } }),
        prisma.itemLog.count({ where: { productId: p.id } }),
      ]);
      return { ...p, _hasHistory: txItems + utangItems + stockBatches + itemLogs > 0 };
    })
  );

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
    },
  });

  broadcastRealtime('products', { action: 'created', product });
  return NextResponse.json(product, { status: 201 });
}
