import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireRole } from '@/lib/server/require-role';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { adjustFifoStock } from '@/lib/server/fifo';
import { isAdjustmentType, ADJUSTMENT_TYPE_LABELS, type AdjustmentMode } from '@/lib/adjustment';

// POST /api/inventory/adjust
// Admin-only stock adjustment. Body:
//   { productId, type, mode?, quantity?, newStock?, reason? }
// - type is required: the adjustment direction itself ("increase" | "decrease")
// - mode "increase" / "decrease": apply `quantity` units relative to current
//   stock (defaults to `type` when omitted)
// - mode "recount": set stock to exact `newStock` — accepted for back-compat,
//   the adjustment modal only sends increase/decrease now
// `reason` (note) is optional.
// Positive deltas add an "Adjustment" FIFO layer; negative deltas consume
// oldest layers first. Always audited as ItemLog action='adjusted' with the
// type + note persisted.
const MODES: AdjustmentMode[] = ['increase', 'decrease', 'recount'];

export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const session = await getServerSession(authOptions);
  const { productId, newStock, quantity, mode, type, reason } = await request.json();

  const pid = Number(productId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return NextResponse.json({ error: 'productId is required' }, { status: 400 });
  }
  if (!isAdjustmentType(type)) {
    return NextResponse.json(
      { error: `type is required: one of ${Object.values(ADJUSTMENT_TYPE_LABELS).join(', ')}` },
      { status: 400 }
    );
  }
  const note = reason ? String(reason).slice(0, 200).trim() : null;

  // Omitted mode falls back to the selected type (direction IS the type now).
  const requestedMode = mode === undefined ? type : mode;
  if (!MODES.includes(requestedMode as AdjustmentMode)) {
    return NextResponse.json({ error: 'mode must be "increase", "decrease" or "recount"' }, { status: 400 });
  }
  const adjMode = requestedMode as AdjustmentMode;

  let countedStock: number | null = null;
  let deltaQty = 0;
  if (adjMode === 'recount') {
    countedStock = Number(newStock);
    if (!Number.isInteger(countedStock) || countedStock < 0) {
      return NextResponse.json({ error: 'newStock must be a non-negative integer' }, { status: 400 });
    }
  } else {
    deltaQty = Number(quantity);
    if (!Number.isInteger(deltaQty) || deltaQty <= 0) {
      return NextResponse.json({ error: 'quantity must be a positive integer' }, { status: 400 });
    }
  }

  const cashierId = Number(session!.user.id);
  if (!Number.isFinite(cashierId)) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: pid } });
      if (!product) throw new Error('Product not found');
      let target: number;
      if (adjMode === 'recount') {
        target = countedStock!;
      } else if (adjMode === 'increase') {
        target = product.stock + deltaQty;
      } else {
        target = product.stock - deltaQty;
        if (target < 0) {
          throw new Error(`Cannot decrease by ${deltaQty} — only ${product.stock} in stock`);
        }
      }

      const delta = await adjustFifoStock(tx, product, target, `Adjustment (${ADJUSTMENT_TYPE_LABELS[type]})`);
      await tx.itemLog.create({
        data: {
          productId: pid,
          action: 'adjusted',
          quantity: delta,
          adjustType: type,
          note,
          performedBy: cashierId,
        },
      });
      const updated = await tx.product.findUnique({ where: { id: pid } });
      return { product: updated, delta, mode: adjMode, type };
      // ~10 sequential round trips (FIFO layers + audit log + re-read) per
      // adjustment; the 5s Prisma default expired during slow DB moments.
    }, { maxWait: 10_000, timeout: 15_000 });

    broadcastRealtime('products', { action: 'stock-updated', product: result.product });
    broadcastRealtime('itemlog', { action: 'created' });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Adjustment failed';
    const status = message === 'Product not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
