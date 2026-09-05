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

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json();
  const items: CartItem[] = body.items;
  const customerId: number | null = body.customerId ?? null;
  const paymentMethod: string = body.paymentMethod;
  let tendered: number = Number(body.tendered ?? 0);

  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }

  if (Number.isNaN(tendered) || tendered < 0) {
    tendered = 0;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const productIds = items.map((i) => i.productId);
      const allProducts = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(allProducts.map((p) => [p.id, p]));

      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product) throw new Error(`Product #${item.productId} not found`);
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name} (available: ${product.stock}, required: ${item.quantity})`);
        }
      }

      const settings = await tx.settings.findFirst();
      const taxRate = settings?.taxRate ?? 12;

      const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      let vat = 0;
      for (const item of items) {
        const product = productMap.get(item.productId);
        if (product?.vatType === 'regular') {
          const lineTotal = item.quantity * item.unitPrice;
          vat += lineTotal * (taxRate / (100 + taxRate));
        }
      }
      vat = Number(vat.toFixed(2));

      const total = Number(subtotal.toFixed(2));

      if (paymentMethod === 'gcash' && (tendered < total || tendered === 0)) {
        tendered = total;
      }

      if (tendered < total) {
        throw new Error(`Cash tendered (₱${tendered.toFixed(2)}) is less than total amount (₱${total.toFixed(2)})`);
      }

      const change = Number((tendered - total).toFixed(2));

      const transaction = await tx.transaction.create({
        data: {
          cashierId: Number(session.user.id),
          customerId,
          paymentMethod,
          subtotal,
          vat,
          total,
          tendered,
          change,
          status: 'complete',
        },
        include: {
          customer: true,
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
    }, {
      maxWait: 15000,
      timeout: 25000,
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
