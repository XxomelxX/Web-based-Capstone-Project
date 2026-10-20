import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { executeVoidTransaction } from '@/lib/server/void-transaction';
import { verifySupervisor } from '@/lib/server/supervisor';

// POST /api/transactions/:id/void   body: { reason: string, adminUsername?: string, adminPassword?: string }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const transactionId = Number(idParam);
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const { reason, adminUsername, adminPassword } = await request.json();

  if (!reason) {
    return NextResponse.json({ error: 'Void reason is required' }, { status: 400 });
  }

  let voidedByUserId = Number(session.user.id);

  // If cashier is executing, require supervisor credentials
  if (session.user.role === 'cashier') {
    const gate = await verifySupervisor(adminUsername, adminPassword);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    voidedByUserId = gate.adminId; // Override auditor to the admin who authorized it!
  }

  try {
    const result = await executeVoidTransaction(transactionId, reason, voidedByUserId);

    broadcastRealtime('transactions', { action: 'voided', transaction: result });
    broadcastRealtime('products', { action: 'stock-updated' });
    broadcastRealtime('itemlog', { action: 'created' });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Transaction not found') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Void failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
