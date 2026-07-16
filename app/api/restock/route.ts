import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastRealtime } from '@/lib/realtime';

// POST /api/restock  body: { productId, quantity, supplier?, costPerUnit? }
export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const session = await getServerSession(authOptions);
  const { productId, quantity, supplier, costPerUnit } = await request.json();

  if (!productId || !quantity || quantity <= 0) {
    return NextResponse.json({ error: 'productId and a positive quantity are required' }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.stockBatch.create({
      data: {
        productId: Number(productId),
        quantityReceived: Number(quantity),
        quantityRemaining: Number(quantity),
        supplier: supplier ?? null,
        costPerUnit: costPerUnit != null ? Number(costPerUnit) : null,
      },
    });

    const product = await tx.product.update({
      where: { id: Number(productId) },
      data: { stock: { increment: Number(quantity) } },
    });

    await tx.itemLog.create({
      data: {
        productId: Number(productId),
        action: 'restocked',
        quantity: Number(quantity),
        performedBy: Number(session!.user.id),
      },
    });

    return { batch, product };
  });

  broadcastRealtime('restock', { action: 'created', result });
  broadcastRealtime('products', { action: 'updated', product: result.product });
  return NextResponse.json(result, { status: 201 });
}
