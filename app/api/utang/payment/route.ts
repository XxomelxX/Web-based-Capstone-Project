import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { isDbUnreachable, DB_UNAVAILABLE_MESSAGE } from '@/lib/server/db-unreachable';

// POST /api/utang/payment  body: { customerName, amount, note? }
// Applies payment FIFO across the customer's oldest unpaid/partial entries first.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { customerName, amount: amountRaw, note, clientUuid } = await request.json() as {
    customerName: string; amount: number; note?: string; clientUuid?: string;
  };
  const amount = Number(amountRaw);

  if (!customerName || !Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'customerName and a positive integer amount (centavos) are required' }, { status: 400 });
  }

  // Idempotency: replay returns the original payment + allocations.
  if (clientUuid) {
    const existing = await prisma.payment.findUnique({
      where: { clientUuid },
      include: { allocations: true },
    });
    if (existing) {
      const applied = existing.allocations.reduce((s, a) => s + a.amountApplied, 0);
      return NextResponse.json({
        payment: existing,
        allocations: existing.allocations,
        unallocatedRemainder: Math.max(0, existing.amount - applied),
        replayed: true,
      }, { status: 200 });
    }
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: { name: { equals: customerName.trim(), mode: 'insensitive' } },
    });
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const outstandingEntries = await tx.utangEntry.findMany({
        where: { customerId: customer.id, status: { in: ['unpaid', 'partial'] } },
        orderBy: { createdAt: 'asc' }, // oldest first (FIFO)
      });

      if (outstandingEntries.length === 0) {
        throw new Error('This customer has no outstanding utang');
      }

      // Create the Payment record first
      const payment = await tx.payment.create({
        data: { clientUuid: clientUuid ?? undefined, amount, note: note ?? null, recordedBy: Number(session.user.id) },
      });

      let remainingPayment = amount;
      const allocations = [];

      for (const entry of outstandingEntries) {
        if (remainingPayment <= 0) break;

        const applyAmount = Math.min(remainingPayment, entry.remainingBalance);
        if (applyAmount <= 0) continue;

        // Relative guarded write: absolute writes lost concurrent payments
        // (both read the same balance, both overwrite). count 0 means the
        // balance moved under us — roll the whole payment back.
        const guarded = await tx.utangEntry.updateMany({
          where: { id: entry.id, remainingBalance: { gte: applyAmount } },
          data: {
            remainingBalance: { decrement: applyAmount },
            amountPaid: { increment: applyAmount },
          },
        });
        if (guarded.count !== 1) {
          throw new Error('Utang balance changed concurrently — payment rolled back, please retry');
        }

        // Status derives from the post-write balance (the row is locked by our
        // update, so this read sees our decrement, not the stale snapshot).
        const settled = await tx.utangEntry.findUnique({
          where: { id: entry.id },
          select: { remainingBalance: true },
        });
        await tx.utangEntry.update({
          where: { id: entry.id },
          data: { status: (settled?.remainingBalance ?? 0) <= 0 ? 'paid' : 'partial' },
        });

        const allocation = await tx.paymentAllocation.create({
          data: { paymentId: payment.id, utangEntryId: entry.id, amountApplied: applyAmount },
        });

        allocations.push(allocation);
        remainingPayment -= applyAmount;
      }

      return { payment, allocations, unallocatedRemainder: remainingPayment };
    }, { maxWait: 15000, timeout: 25000 });

    broadcastRealtime('utang', { action: 'payment', result });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // Database down: friendly 503 instead of leaking engine text.
    if (isDbUnreachable(err)) {
      return NextResponse.json({ error: DB_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    if (clientUuid && typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      const existing = await prisma.payment.findUnique({
        where: { clientUuid },
        include: { allocations: true },
      });
      if (existing) {
        const applied = existing.allocations.reduce((s, a) => s + a.amountApplied, 0);
        return NextResponse.json({
          payment: existing,
          allocations: existing.allocations,
          unallocatedRemainder: Math.max(0, existing.amount - applied),
          replayed: true,
        }, { status: 200 });
      }
    }
    const message = err instanceof Error ? err.message : 'Payment failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
