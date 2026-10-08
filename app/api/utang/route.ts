import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';

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

  if (!customerName || !items || items.length === 0) {
    return NextResponse.json({ error: 'customerName and at least one item are required' }, { status: 400 });
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
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}`);
        }
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
