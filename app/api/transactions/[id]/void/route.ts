import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastRealtime } from '@/lib/realtime';

// POST /api/transactions/:id/void   body: { reason: string, adminUsername?: string, adminPassword?: string }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const transactionId = Number(idParam);
  const { reason, adminUsername, adminPassword } = await request.json();

  if (!reason) {
    return NextResponse.json({ error: 'Void reason is required' }, { status: 400 });
  }

  let voidedByUserId = Number(session.user.id);

  // If cashier is executing, require supervisor credentials
  if (session.user.role === 'cashier') {
    if (!adminUsername || !adminPassword) {
      return NextResponse.json({ error: 'Supervisor authorization required to void transactions.' }, { status: 403 });
    }

    const adminUser = await prisma.user.findUnique({
      where: { username: adminUsername },
    });

    if (!adminUser || adminUser.status !== 'active' || adminUser.role !== 'admin') {
      return NextResponse.json({ error: 'Invalid supervisor credentials.' }, { status: 403 });
    }

    const compare = (await import('bcryptjs')).compare;
    const isValid = await compare(adminPassword, adminUser.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid supervisor password.' }, { status: 403 });
    }

    voidedByUserId = adminUser.id; // Override auditor to the admin who authorized it!
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
            performedBy: voidedByUserId,
          },
        });
      }

      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: 'voided',
          voidReason: reason,
          voidedBy: voidedByUserId,
          voidedAt: new Date(),
        },
      });

      return updated;
    }, {
      maxWait: 15000,
      timeout: 25000,
    });

    broadcastRealtime('transactions', { action: 'voided', transaction: result });
    broadcastRealtime('products', { action: 'stock-updated' });
    broadcastRealtime('itemlog', { action: 'created' });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Void failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
