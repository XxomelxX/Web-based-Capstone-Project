import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/utang/payment  body: { customerName, amount, note? }
// Applies payment FIFO across the customer's oldest unpaid/partial entries first.
export async function POST(request: Request) {
  const { customerName, amount, note } = await request.json() as {
    customerName: string; amount: number; note?: string;
  };

  if (!customerName || !amount || amount <= 0) {
    return NextResponse.json({ error: 'customerName and a positive amount are required' }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { name: customerName } });
      if (!customer) throw new Error('Customer not found');

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

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
