import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { consumeFifoStock, type ConsumeSlice } from '@/lib/server/fifo';
import { isDbUnreachable, DB_UNAVAILABLE_MESSAGE } from '@/lib/server/db-unreachable';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const entries = await prisma.utangEntry.findMany({
    include: {
      customer: true,
      items: { include: { product: true } },
      paymentAllocations: { include: { payment: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(entries);
}

interface UtangItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

// POST /api/utang  body: { customerName, items: UtangItem[], note? }
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { customerName, items, note, clientUuid, dueDate: dueDateRaw } = await request.json() as {
    customerName: string; items: UtangItem[]; note?: string; clientUuid?: string; dueDate?: string | null;
  };

  if (typeof customerName !== 'string' || !customerName.trim() || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'customerName and at least one item are required' }, { status: 400 });
  }

  // Reject malformed line items before they reach stock math: a negative or
  // fractional quantity used to invert the stock decrement and the total.
  for (const item of items) {
    if (!item || typeof item !== 'object'
      || !Number.isInteger(item.productId) || item.productId <= 0
      || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return NextResponse.json(
        { error: 'Each item requires a positive integer productId and quantity' },
        { status: 400 }
      );
    }
  }

  // Optional custom deadline (datetime). Must be a valid date; past dates are
  // rejected at creation (use edit to backdate a correction).
  let dueDate: Date | null = null;
  if (dueDateRaw !== undefined && dueDateRaw !== null && dueDateRaw !== '') {
    const parsed = new Date(dueDateRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid dueDate' }, { status: 400 });
    }
    if (parsed.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Deadline must be in the future' }, { status: 400 });
    }
    dueDate = parsed;
  }

  // Idempotency: replay of an already-synced offline action returns the original.
  if (clientUuid) {
    const existing = await prisma.utangEntry.findUnique({
      where: { clientUuid },
      include: { customer: true, items: { include: { product: true } } },
    });
    if (existing) return NextResponse.json(existing, { status: 200 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // find or create customer (normalized lookup)
      let customer = await tx.customer.findFirst({
        where: { name: { equals: customerName.trim(), mode: 'insensitive' } },
      });
      if (!customer) {
        customer = await tx.customer.create({ data: { name: customerName.trim() } });
      }

      // Validate products + guarded decrement once per PRODUCT (slice rows must
      // never trigger extra decrements). The guarded write is the race gate:
      // count 0 rolls the whole utang back.
      const productIds = items.map((i) => i.productId);
      const allProducts = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(allProducts.map((p) => [p.id, p]));
      const quantityByProduct = new Map<number, number>();
      for (const item of items) {
        if (!productMap.has(item.productId)) throw new Error(`Product ${item.productId} not found`);
        quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
      }
      for (const [productId, quantity] of quantityByProduct) {
        const stockUpdate = await tx.product.updateMany({
          where: { id: productId, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });
        if (stockUpdate.count !== 1) {
          const product = productMap.get(productId);
          throw new Error(`Insufficient stock for ${product?.name ?? `product #${productId}`}`);
        }
      }

      // FIFO per item line: each consumed layer is its own priced slice
      // (batch.pricePerUnit ?? product.price). Client unitPrice is ignored.
      const soldByProduct = new Map<number, number>();
      const plans: { productId: number; slices: ConsumeSlice[] }[] = [];
      let totalAmount = 0;
      for (const item of items) {
        const slices = await consumeFifoStock(tx, item.productId, item.quantity);
        totalAmount += slices.reduce((sum, s) => sum + s.quantity * s.unitPrice, 0);
        soldByProduct.set(item.productId, (soldByProduct.get(item.productId) ?? 0) + item.quantity);
        plans.push({ productId: item.productId, slices });
      }

      const utangEntry = await tx.utangEntry.create({
        include: { customer: true, items: true },
        data: {
          clientUuid: clientUuid ?? undefined,
          customerId: customer.id,
          totalAmount,
          amountPaid: 0,
          remainingBalance: totalAmount,
          note: note ?? null,
          status: 'unpaid',
          dueDate,
        },
      });

      // One utang row per consumed FIFO slice (each at its own layer price).
      for (const plan of plans) {
        for (const slice of plan.slices) {
          await tx.utangEntryItem.create({
            data: {
              utangEntryId: utangEntry.id,
              productId: plan.productId,
              quantity: slice.quantity,
              unitPrice: slice.unitPrice,
              lineTotal: slice.quantity * slice.unitPrice,
            },
          });
        }
      }

      // Item log stays ONE row per product per transaction.
      for (const [productId, quantity] of soldByProduct) {
        await tx.itemLog.create({
          data: {
            productId,
            action: 'sold',
            quantity,
            performedBy: Number(session.user.id),
          },
        });
      }

      const txn = await tx.transaction.create({
        data: {
          clientUuid: clientUuid ? `utang-${clientUuid}` : undefined,
          cashierId: Number(session.user.id),
          customerId: customer.id,
          paymentMethod: 'credit',
          subtotal: totalAmount,
          vat: 0,
          total: totalAmount,
          tendered: 0,
          change: 0,
          status: 'complete',
        },
      });

      for (const plan of plans) {
        for (const slice of plan.slices) {
          await tx.transactionItem.create({
            data: {
              transactionId: txn.id,
              productId: plan.productId,
              quantity: slice.quantity,
              unitPrice: slice.unitPrice,
              lineTotal: slice.quantity * slice.unitPrice,
            },
          });
        }
      }

      return utangEntry;
    }, {
      maxWait: 15000,
      timeout: 25000,
    });

    broadcastRealtime('utang', { action: 'created', entry: result });
    broadcastRealtime('transactions', { action: 'created' });
    broadcastRealtime('products', { action: 'stock-updated' });
    broadcastRealtime('itemlog', { action: 'created' });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // Database down: friendly 503 instead of leaking engine text.
    if (isDbUnreachable(err)) {
      return NextResponse.json({ error: DB_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    if (clientUuid && typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      const existing = await prisma.utangEntry.findUnique({
        where: { clientUuid },
        include: { customer: true, items: { include: { product: true } } },
      });
      if (existing) return NextResponse.json(existing, { status: 200 });
    }
    const message = err instanceof Error ? err.message : 'Failed to add utang';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
