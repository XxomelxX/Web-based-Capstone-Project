import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { consumeFifoStock } from '@/lib/server/fifo';
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

      // validate stock + server-side pricing from DB
      const productIds = items.map((i) => i.productId);
      const allProducts = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(allProducts.map((p) => [p.id, p]));
      const priced = items.map((item) => {
        const product = productMap.get(item.productId);
        if (!product) throw new Error(`Product ${item.productId} not found`);
        return { ...item, unitPrice: product.price };
      });

      const totalAmount = priced.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

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

      for (const item of priced) {
        await tx.utangEntryItem.create({
          data: {
            utangEntryId: utangEntry.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.quantity * item.unitPrice,
          },
        });

        // Conditional decrement: read-then-write races concurrent sales of the
        // last unit — the guarded write rolls the whole utang back on count 0.
        const stockUpdate = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (stockUpdate.count !== 1) {
          const product = productMap.get(item.productId);
          throw new Error(`Insufficient stock for ${product?.name ?? `product #${item.productId}`}`);
        }

        // FIFO: utang sales consume the oldest stock layers first.
        await consumeFifoStock(tx, item.productId, item.quantity);

        await tx.itemLog.create({
          data: {
            productId: item.productId,
            action: 'sold',
            quantity: item.quantity,
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

      for (const item of priced) {
        await tx.transactionItem.create({
          data: {
            transactionId: txn.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.quantity * item.unitPrice,
          },
        });
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
