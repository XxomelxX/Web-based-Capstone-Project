import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastRealtime } from '@/lib/realtime';

// POST /api/utang/payment  body: { customerName, amount, note? }
// Applies payment FIFO across the customer's oldest unpaid/partial entries first.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { customerName, amount: amountRaw, note } = await request.json() as {
    customerName: string; amount: number; note?: string;
  };
  const amount = Number(amountRaw);

  if (!customerName || Number.isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'customerName and a positive amount are required' }, { status: 400 });
  }

  try {
    // Look up the customer outside the transaction to avoid mode:'insensitive' issues
    const allCustomers = await prisma.customer.findMany();
    const customer = allCustomers.find(
      (c) => c.name.trim().toLowerCase() === customerName.trim().toLowerCase()
    );
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
        data: { amount, note: note ?? null },
      });

      let remainingPayment = amount;
      const allocations = [];

      for (const entry of outstandingEntries) {
        if (remainingPayment <= 0) break;

        const applyAmount = Math.min(remainingPayment, entry.remainingBalance);
        const newAmountPaid = entry.amountPaid + applyAmount;
        const newRemaining = entry.remainingBalance - applyAmount;
        const newStatus = newRemaining <= 0 ? 'paid' : 'partial';

        await tx.utangEntry.update({
          where: { id: entry.id },
          data: { amountPaid: newAmountPaid, remainingBalance: newRemaining, status: newStatus },
        });

        const allocation = await tx.paymentAllocation.create({
          data: { paymentId: payment.id, utangEntryId: entry.id, amountApplied: applyAmount },
        });

        allocations.push(allocation);
        remainingPayment -= applyAmount;
      }

      return { payment, allocations, unallocatedRemainder: remainingPayment };
    });

    broadcastRealtime('utang', { action: 'payment', result });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
