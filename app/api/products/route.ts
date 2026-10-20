import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { requireRole } from '@/lib/server/require-role';
import { requireSession } from '@/lib/server/require-session';
import { broadcastRealtime } from '@/lib/server/realtime';
import { getActiveLayerInfo } from '@/lib/server/fifo';

const VALID_VAT = ['exempt', 'regular', 'zero-rated'];

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
  const [txCounts, utangCounts, batchCounts, logCounts, layerInfo] = await Promise.all([
    prisma.transactionItem.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
    prisma.utangEntryItem.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
    prisma.stockBatch.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
    prisma.itemLog.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: true }),
    getActiveLayerInfo(prisma, productIds),
  ]);

  const txMap = new Map(txCounts.map((r) => [r.productId, r._count]));
  const utangMap = new Map(utangCounts.map((r) => [r.productId, r._count]));
  const batchMap = new Map(batchCounts.map((r) => [r.productId, r._count]));
  const logMap = new Map(logCounts.map((r) => [r.productId, r._count]));

  const productsWithHistory = products.map((p) => {
    const count = (txMap.get(p.id) ?? 0) + (utangMap.get(p.id) ?? 0) + (batchMap.get(p.id) ?? 0) + (logMap.get(p.id) ?? 0);
    return {
      ...p,
      _hasHistory: count > 0,
      activeLayerCost: layerInfo.get(p.id)?.costPerUnit ?? null,
      // Raw active-batch selling price; null/absent => client falls back to price.
      activeLayerPrice: layerInfo.get(p.id)?.pricePerUnit ?? null,
    };
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

  const price = Number(data.price);
  const cost = Number(data.cost ?? 0);
  const stock = Number(data.stock);
  if (!Number.isInteger(price) || price < 0 || !Number.isInteger(cost) || cost < 0) {
    return NextResponse.json({ error: 'price and cost must be non-negative integers in centavos' }, { status: 400 });
  }
  if (!Number.isInteger(stock) || stock < 0) {
    return NextResponse.json({ error: 'stock must be a non-negative integer' }, { status: 400 });
  }
  if (data.vatType !== undefined && !VALID_VAT.includes(data.vatType)) {
    return NextResponse.json({ error: 'Invalid vatType' }, { status: 400 });
  }

  try {
    // Product + opening batch must be atomic: Product.stock must always equal
    // the sum of StockBatch layers (see lib/server/fifo.ts conventions).
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: String(data.name).trim(),
          categoryId: Number(data.categoryId),
          price,
          cost,
          stock,
          packSize: data.packSize ?? null,
          unit: data.unit ?? null,
          barcode: data.barcode ?? null,
          goodsType: data.goodsType ?? 'non-perishable',
          vatType: data.vatType ?? 'exempt',
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        },
      });
      if (stock > 0) {
        await tx.stockBatch.create({
          data: {
            productId: created.id,
            quantityReceived: stock,
            quantityRemaining: stock,
            supplier: 'Opening stock',
            costPerUnit: cost,
            // Synthetic opening layer sells at the product's current price.
            pricePerUnit: created.price,
          },
        });
      }
      return created;
    }, { maxWait: 10_000, timeout: 15_000 });

    broadcastRealtime('products', { action: 'created', product });
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Barcode already in use' }, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
