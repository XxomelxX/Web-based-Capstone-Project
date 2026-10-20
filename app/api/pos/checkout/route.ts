import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { consumeFifoStock, type ConsumeSlice } from '@/lib/server/fifo';
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

      // Guarded decrement once per PRODUCT (a cart may repeat a product; slice
      // rows must never trigger extra decrements). The conditional write is
      // the authoritative race gate — count 0 rolls the transaction back.
      const quantityByProduct = new Map<number, number>();
      for (const item of items) {
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

      // FIFO per item line: each consumed layer becomes a priced slice charged
      // at its own selling price (batch.pricePerUnit ?? product.price).
      // Server-side pricing: client unitPrice is ignored.
      let subtotal = 0;
      let vat = 0;
      const soldByProduct = new Map<number, number>();
      const plans: { productId: number; quantity: number; slices: ConsumeSlice[] }[] = [];
      for (const item of items) {
        const product = productMap.get(item.productId)!;
        const slices = await consumeFifoStock(tx, item.productId, item.quantity);
        const lineTotal = slices.reduce((sum, s) => sum + s.quantity * s.unitPrice, 0);
        subtotal += lineTotal;
        // VAT-inclusive pricing: extracted once per CART LINE (product), not
        // per slice, so multi-layer rounding stays identical to the old
        // one-row-per-line behavior and the sum of lines equals the total.
        if (product.vatType === 'regular') {
          vat += Math.round((lineTotal * taxRate) / (100 + taxRate));
        }
        soldByProduct.set(item.productId, (soldByProduct.get(item.productId) ?? 0) + item.quantity);
        plans.push({ productId: item.productId, quantity: item.quantity, slices });
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

      // One sale row per consumed FIFO slice. A single-layer sale still yields
      // exactly one row identical to the old behavior; a sale spanning layers
      // is split so each unit is charged its own layer price.
      for (const plan of plans) {
        for (const slice of plan.slices) {
          await tx.transactionItem.create({
            data: {
              transactionId: transaction.id,
              productId: plan.productId,
              quantity: slice.quantity,
              unitPrice: slice.unitPrice,
              lineTotal: slice.quantity * slice.unitPrice,
            },
          });
        }
      }

      // Item log stays ONE row per product per transaction (the history UI
      // renders a line per row; slices must not multiply it).
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
