import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { consumeFifoStock } from '@/lib/server/fifo';
import { isDbUnreachable, DB_UNAVAILABLE_MESSAGE } from '@/lib/server/db-unreachable';
import { peso } from '@/lib/money';

interface CartItem {
  productId: number;
  quantity: number;
  unitPrice: number; // centavos (server re-prices anyway; kept for payload shape)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json();
  const clientUuid: string | undefined = typeof body.clientUuid === 'string' ? body.clientUuid : undefined;
  const items: CartItem[] = body.items;
  const customerId: number | null = body.customerId ?? null;
  const paymentMethod: string = body.paymentMethod;
  const gcashRef: string | undefined = typeof body.gcashRef === 'string' && body.gcashRef.trim() ? body.gcashRef.trim().slice(0, 50) : undefined;
  let tendered: number = Number(body.tendered ?? 0);

  // Shift close only counts exact 'cash'/'gcash' — reject anything else loudly.
  if (paymentMethod !== 'cash' && paymentMethod !== 'gcash') {
    return NextResponse.json({ error: 'paymentMethod must be "cash" or "gcash"' }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }

  // Reject malformed line items before they reach stock math: a negative or
  // fractional quantity used to invert the stock decrement and the sale total.
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

  // Money is integer centavos end-to-end; reject legacy float payloads loudly
  // instead of silently truncating (old cached clients must reload).
  if (!Number.isInteger(tendered) || tendered < 0) {
    return NextResponse.json({ error: 'tendered must be an integer amount in centavos' }, { status: 400 });
  }

  try {
    if (clientUuid) {
      const existing = await prisma.transaction.findUnique({ where: { clientUuid } });
      if (existing) return NextResponse.json(existing, { status: 200 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const productIds = items.map((i) => i.productId);
      const allProducts = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(allProducts.map((p) => [p.id, p]));

      for (const item of items) {
        if (!productMap.has(item.productId)) throw new Error(`Product #${item.productId} not found`);
      }

      const settings = await tx.settings.findFirst();
      const taxRate = settings?.taxRate ?? 12;

      // Server-side pricing: ignore client unitPrice, use DB price.
      const priced = items.map((i) => {
        const product = productMap.get(i.productId)!;
        return { ...i, unitPrice: product.price };
      });

      const subtotal = priced.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      // VAT-inclusive pricing: extract VAT per line (integer centavos, rounded
      // per line so the sum of lines always equals the receipt total).
      let vat = 0;
      for (const item of priced) {
        const product = productMap.get(item.productId);
        if (product?.vatType === 'regular') {
          const lineTotal = item.quantity * item.unitPrice;
          vat += Math.round((lineTotal * taxRate) / (100 + taxRate));
        }
      }

      const total = subtotal;

      if (paymentMethod === 'gcash' && (tendered < total || tendered === 0)) {
        tendered = total;
      }

      if (tendered < total) {
        throw new Error(`Cash tendered (${peso(tendered)}) is less than total amount (${peso(total)})`);
      }

      const change = tendered - total;

      const cashierId = Number(session.user.id);
      if (!Number.isFinite(cashierId)) throw new Error('Invalid session');

      const isGcash = paymentMethod === 'gcash';
      const transaction = await tx.transaction.create({
        data: {
          clientUuid,
          cashierId,
          customerId,
          paymentMethod,
          subtotal,
          vat,
          total,
          tendered,
          change,
          status: 'complete',
          gcashRef: isGcash ? (gcashRef ?? null) : null,
        },
        include: {
          customer: true,
        },
      });

      for (const item of priced) {
        await tx.transactionItem.create({
          data: {
            transactionId: transaction.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.quantity * item.unitPrice,
          },
        });

        // Conditional decrement: a plain read-then-write races concurrent
        // checkouts of the last unit (both pass the check, stock goes negative).
        // The guarded write is the authoritative gate — count 0 means the
        // transaction rolls back with a stock error.
        const stockUpdate = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (stockUpdate.count !== 1) {
          const product = productMap.get(item.productId);
          throw new Error(`Insufficient stock for ${product?.name ?? `product #${item.productId}`}`);
        }

        // FIFO: consume the oldest stock layers first (same transaction).
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

      return transaction;
    }, {
      maxWait: 15000,
      timeout: 25000,
    });

    broadcastRealtime('transactions', { action: 'created', transaction: result });
    broadcastRealtime('products', { action: 'stock-updated' });
    broadcastRealtime('itemlog', { action: 'created' });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // Database down: friendly 503 instead of leaking engine text.
    if (isDbUnreachable(err)) {
      return NextResponse.json({ error: DB_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    // Unique-constraint race on clientUuid: return the winner's row.
    if (clientUuid && typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      const existing = await prisma.transaction.findUnique({ where: { clientUuid } });
      if (existing) return NextResponse.json(existing, { status: 200 });
    }
    const message = err instanceof Error ? err.message : 'Checkout failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
