import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// POST /api/transactions/:id/void   body: { reason: string }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const transactionId = Number(idParam);
  const { reason } = await request.json();

  if (!reason) {
    return NextResponse.json({ error: 'Void reason is required' }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { items: true },
      });

      if (!transaction) throw new Error('Transaction not found');
      if (transaction.status === 'voided') throw new Error('Transaction already voided');

      // Restore stock for every item in this sale
      for (const item of transaction.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });

        await tx.itemLog.create({
          data: {
            productId: item.productId,
            action: 'voided',
            quantity: item.quantity,
            performedBy: Number(session.user.id),
          },
        });
      }

      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: 'voided',
          voidReason: reason,
          voidedBy: Number(session.user.id),
          voidedAt: new Date(),
        },
      });

      return updated;
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Void failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
