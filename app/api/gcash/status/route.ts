import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { getEwalletChargeStatus, normalizeXenditStatus } from '@/lib/server/xendit';

// GET /api/gcash/status?referenceId=... or ?paymentId=...
// Polling fallback for when the Xendit webhook is delayed. Syncs the local
// Transaction.xenditStatus with Xendit's latest status (no money movement here).
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const referenceId = searchParams.get('referenceId');
  const paymentId = searchParams.get('paymentId');
  if (!referenceId && !paymentId) {
    return NextResponse.json({ error: 'referenceId or paymentId required' }, { status: 400 });
  }

  const txn = await prisma.transaction.findFirst({
    where: paymentId ? { xenditPaymentId: paymentId } : { clientUuid: referenceId! },
    select: { id: true, xenditPaymentId: true, xenditStatus: true, needsVerification: true, total: true },
  });
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  if (!txn.xenditPaymentId) {
    return NextResponse.json({ transactionId: txn.id, xenditStatus: txn.xenditStatus ?? 'PENDING', needsVerification: txn.needsVerification });
  }

  try {
    const live = await getEwalletChargeStatus(txn.xenditPaymentId);
    if (!live) return NextResponse.json({ transactionId: txn.id, xenditStatus: txn.xenditStatus, needsVerification: txn.needsVerification });
    const normalized = normalizeXenditStatus(live.status);
    if (normalized !== txn.xenditStatus) {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: { xenditStatus: normalized, needsVerification: normalized !== 'SUCCEEDED' },
      });
    }
    return NextResponse.json({ transactionId: txn.id, xenditStatus: normalized, needsVerification: normalized !== 'SUCCEEDED' });
  } catch (err) {
    // Xendit unreachable — return last known local status so POS can keep polling.
    return NextResponse.json({
      transactionId: txn.id,
      xenditStatus: txn.xenditStatus,
      needsVerification: txn.needsVerification,
      warning: err instanceof Error ? err.message : 'Xendit lookup failed',
    });
  }
}
