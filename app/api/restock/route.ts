import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireRole } from '@/lib/server/require-role';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';

// POST /api/restock  body: { productId, quantity, supplier?, costPerUnit?, pricePerUnit? }
// Only admins may restock products. Cashiers have a read-only view (no restock UI,
// and direct API calls are rejected with 403).
export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const session = await getServerSession(authOptions);
  const { productId, quantity, supplier, costPerUnit, pricePerUnit } = await request.json();

  const pid = Number(productId);
  const qty = Number(quantity);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: 'productId and a positive integer quantity are required' }, { status: 400 });
  }
  if (costPerUnit != null && (!Number.isInteger(Number(costPerUnit)) || Number(costPerUnit) < 0)) {
    return NextResponse.json({ error: 'costPerUnit must be a non-negative integer in centavos' }, { status: 400 });
  }
  // Optional per-batch SELLING price: null/omitted means "sell at product.price"
  // (batch pricing: oldest layer with stock is charged at its own price).
  if (pricePerUnit != null && (!Number.isInteger(Number(pricePerUnit)) || Number(pricePerUnit) < 0)) {
    return NextResponse.json({ error: 'pricePerUnit must be a non-negative integer in centavos' }, { status: 400 });
  }

  const cashierId = Number(session!.user.id);
  if (!Number.isFinite(cashierId)) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.stockBatch.create({
        data: {
          productId: pid,
          quantityReceived: qty,
          quantityRemaining: qty,
          supplier: supplier ?? null,
          costPerUnit: costPerUnit != null ? Number(costPerUnit) : null,
          pricePerUnit: pricePerUnit != null ? Number(pricePerUnit) : null,
        },
      });

      const product = await tx.product.update({
        where: { id: pid },
        data: { stock: { increment: qty } },
      });

      await tx.itemLog.create({
        data: {
          productId: pid,
          action: 'restocked',
          quantity: qty,
          performedBy: cashierId,
        },
      });

      return { batch, product };
    }, { maxWait: 15000, timeout: 25000 });

    broadcastRealtime('restock', { action: 'created', result });
    broadcastRealtime('products', { action: 'updated', product: result.product });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2003') {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
