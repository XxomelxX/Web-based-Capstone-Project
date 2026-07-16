import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastRealtime } from '@/lib/realtime';

export async function GET() {
  const entries = await prisma.utangEntry.findMany({
    include: { customer: true, items: { include: { product: true } } },
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

  const { customerName, items, note } = await request.json() as {
    customerName: string; items: UtangItem[]; note?: string;
  };

  if (!customerName || !items || items.length === 0) {
    return NextResponse.json({ error: 'customerName and at least one item are required' }, { status: 400 });
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

      // validate stock
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product ${item.productId} not found`);
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}`);
        }
      }

      const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      const utangEntry = await tx.utangEntry.create({
        data: {
          customerId: customer.id,
          totalAmount,
          amountPaid: 0,
          remainingBalance: totalAmount,
          note: note ?? null,
          status: 'unpaid',
        },
      });

      for (const item of items) {
        await tx.utangEntryItem.create({
          data: {
            utangEntryId: utangEntry.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.quantity * item.unitPrice,
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

      return utangEntry;
    });

    broadcastRealtime('utang', { action: 'created', entry: result });
    broadcastRealtime('products', { action: 'stock-updated' });
    broadcastRealtime('itemlog', { action: 'created' });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add utang';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
