import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireSession } from '@/lib/server/require-session';

// GET /api/inventory/batches?productId=123
// Any signed-in role may read FIFO layers (cashiers get a read-only view).
export async function GET(request: Request) {
  const guard = await requireSession();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const pid = Number(searchParams.get('productId'));
  if (!Number.isInteger(pid) || pid <= 0) {
    return NextResponse.json({ error: 'productId is required' }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: pid },
    select: { id: true, name: true, stock: true, cost: true },
  });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const batches = await prisma.stockBatch.findMany({
    where: { productId: pid },
    orderBy: [{ dateReceived: 'asc' }, { id: 'asc' }],
  });

  const remainingTotal = batches.reduce((sum, b) => sum + b.quantityRemaining, 0);
  const remainingValue = batches.reduce(
    (sum, b) => sum + b.quantityRemaining * (b.costPerUnit ?? product.cost),
    0
  );

  return NextResponse.json({
    product,
    batches,
    totals: {
      layerCount: batches.length,
      remainingTotal,
      remainingValue,
      // >0 means units exist outside recorded layers (legacy/seeded stock).
      unlayered: Math.max(product.stock - remainingTotal, 0),
    },
  });
}
