import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { createGcashCharge } from '@/lib/server/xendit';

interface CartItem {
  productId: number;
  quantity: number;
  unitPrice: number;
}

// POST /api/gcash/create — online-only Xendit GCash charge creation.
// Creates a PENDING Transaction row keyed by clientUuid (idempotent), then
// asks Xendit for a GCash checkout URL. The sale only becomes "Paid" when
// Xendit sends payment.capture to /api/webhooks/xendit or status is SUCCEEDED.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const clientUuid: string | undefined = typeof body.clientUuid === 'string' ? body.clientUuid : undefined;
  const items: CartItem[] = body.items ?? [];
  const customerId: number | null = body.customerId ?? null;
  const gcashRef: string | undefined = typeof body.gcashRef === 'string' ? body.gcashRef : undefined;

  if (!items.length) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });

  try {
    // Idempotent replay: same clientUuid returns the existing charge.
    if (clientUuid) {
      const existing = await prisma.transaction.findUnique({ where: { clientUuid } });
      if (existing?.xenditPaymentId) {
        return NextResponse.json({
          transactionId: existing.id,
          referenceId: clientUuid,
          paymentId: existing.xenditPaymentId,
          checkoutUrl: null,
          xenditStatus: existing.xenditStatus,
          reused: true,
        });
      }
    }

    const referenceId = clientUuid ?? crypto.randomUUID();

    // Server-side pricing (same rule as /api/pos/checkout).
    const productIds = items.map((i) => i.productId);
    const allProducts = await prisma.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(allProducts.map((p) => [p.id, p]));
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) return NextResponse.json({ error: `Product #${item.productId} not found` }, { status: 400 });
      if (product.stock < item.quantity) {
        return NextResponse.json({ error: `Insufficient stock for ${product.name}` }, { status: 400 });
      }
    }
    const total = items.reduce((sum, i) => {
      const p = productMap.get(i.productId)!;
      return sum + i.quantity * p.price;
    }, 0);

    // Create the Xendit charge first so a Xendit outage never leaves a stray sale.
    const charge = await createGcashCharge({ referenceId, amount: Number(total.toFixed(2)) });

    const cashierId = Number((session.user as { id?: string }).id);
    if (!Number.isFinite(cashierId)) throw new Error('Invalid session');

    // Record PENDING sale. Stock is decremented only on webhook SUCCEEDED
    // (prevents giving away inventory for abandoned GCash checkouts).
    const priced = items.map((i) => ({ ...i, unitPrice: productMap.get(i.productId)!.price }));
    const subtotal = Number(total.toFixed(2));
    const txn = await prisma.transaction.upsert({
      where: { clientUuid: referenceId },
      create: {
        clientUuid: referenceId,
        cashierId,
        customerId,
        paymentMethod: 'gcash',
        subtotal,
        vat: 0,
        total: subtotal,
        tendered: subtotal,
        change: 0,
        status: 'complete',
        gcashRef: gcashRef?.slice(0, 50) ?? null,
        xenditPaymentId: charge.paymentId || null,
        xenditReferenceId: referenceId,
        xenditStatus: charge.status === 'SUCCEEDED' ? 'SUCCEEDED' : charge.status === 'REQUIRES_ACTION' ? 'REQUIRES_ACTION' : 'PENDING',
        needsVerification: charge.status !== 'SUCCEEDED',
        items: {
          create: priced.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: Number((item.quantity * item.unitPrice).toFixed(2)),
          })),
        },
      },
      update: {},
    });

    return NextResponse.json({
      transactionId: txn.id,
      referenceId,
      paymentId: charge.paymentId,
      checkoutUrl: charge.checkoutUrl ?? null,
      xenditStatus: txn.xenditStatus,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GCash charge creation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
