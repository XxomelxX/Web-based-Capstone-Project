import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastRealtime } from '@/lib/realtime';

interface CartItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

// POST /api/pos/checkout
// body: { items: CartItem[], paymentMethod: 'cash' | 'gcash', tendered: number }
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json();
  const items: CartItem[] = body.items;
  const paymentMethod: string = body.paymentMethod;
  const tendered: number = Number(body.tendered ?? 0);

  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }

  if (Number.isNaN(tendered) || tendered < 0) {
    return NextResponse.json({ error: 'Invalid tendered amount' }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock-step stock validation: re-fetch current stock inside the transaction
      // so two simultaneous sales can't both succeed on insufficient stock.
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product ${item.productId} not found`);
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name} (have ${product.stock}, need ${item.quantity})`);
        }
      }

      const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      const vat = 0;
      const total = Number(subtotal.toFixed(2));

      if (tendered < total) {
        throw new Error('Tendered amount must be at least the total');
      }

      const change = Number((tendered - total).toFixed(2));

      const transaction = await tx.transaction.create({
        data: {
          cashierId: Number(session.user.id),
          paymentMethod,
          subtotal,
          vat,
          total,
          tendered,
          change,
          status: 'complete',
        },
      });

      for (const item of items) {
        await tx.transactionItem.create({
          data: {
            transactionId: transaction.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: Number((item.quantity * item.unitPrice).toFixed(2)),
          },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });

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
    });

    broadcastRealtime('transactions', { action: 'created', transaction: result });
    broadcastRealtime('products', { action: 'stock-updated' });
    broadcastRealtime('itemlog', { action: 'created' });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
