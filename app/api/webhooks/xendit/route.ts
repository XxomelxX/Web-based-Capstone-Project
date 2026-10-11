import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { broadcastRealtime } from '@/lib/server/realtime';
import { normalizeXenditStatus, verifyCallbackToken } from '@/lib/server/xendit';

// POST /api/webhooks/xendit — Xendit payment status callbacks.
// Handles both legacy eWallet payloads ({id, status, reference_id}) and
// Payment Request payloads ({event, data:{payment_id, payment_request_id, reference_id, status}}).
// Money movement (stock decrement) happens ONLY here on SUCCEEDED, so
// abandoned GCash checkouts never drain inventory.
export async function POST(request: Request) {
  const token = request.headers.get('x-callback-token');
  if (!verifyCallbackToken(token)) {
    return NextResponse.json({ error: 'Invalid callback token' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Xendit dashboard "Test and save" sends a probe without payment ids.
  // Return 2XX so the URL saves, without touching the database.
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ ok: true, test: true });
  }
  const data = (body.data ?? body) as Record<string, unknown>;

  const paymentId =
    (typeof data.payment_id === 'string' && data.payment_id) ||
    (typeof data.id === 'string' && data.id) ||
    (typeof body.id === 'string' && (body.id as string)) ||
    null;
  const referenceId =
    (typeof data.reference_id === 'string' && data.reference_id) ||
    (typeof body.reference_id === 'string' && (body.reference_id as string)) ||
    (typeof data.payment_request_id === 'string' && (data.payment_request_id as string)) ||
    null;
  const rawStatus =
    (typeof data.status === 'string' && data.status) ||
    (typeof body.status === 'string' && (body.status as string)) ||
    (typeof body.event === 'string' && body.event.includes('capture') ? 'SUCCEEDED'
      : typeof body.event === 'string' && body.event.includes('failure') ? 'FAILED' : 'PENDING');

  if (!paymentId && !referenceId) {
    // Dashboard test probes or unknown event shapes — acknowledge so Xendit
    // marks the webhook healthy, without creating noise rows.
    return NextResponse.json({ ok: true, test: true });
  }

  const normalized = normalizeXenditStatus(rawStatus);

  const txn = await prisma.transaction.findFirst({
    where: paymentId ? { OR: [{ xenditPaymentId: paymentId }, { clientUuid: referenceId ?? undefined }] } : { clientUuid: referenceId! },
    include: { items: true },
  });
  if (!txn) return NextResponse.json({ ok: true, note: 'Transaction not found — ignored' });

  // Already final — idempotent replay.
  if (txn.xenditStatus === 'SUCCEEDED' || txn.xenditStatus === 'FAILED') {
    return NextResponse.json({ ok: true, transactionId: txn.id, xenditStatus: txn.xenditStatus });
  }

  if (normalized === 'SUCCEEDED') {
    await prisma.$transaction(async (tx) => {
      for (const item of txn.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
        await tx.itemLog.create({ data: { productId: item.productId, action: 'sold', quantity: item.quantity, performedBy: txn.cashierId } });
      }
      await tx.transaction.update({
        where: { id: txn.id },
        data: {
          xenditPaymentId: paymentId ?? txn.xenditPaymentId,
          xenditStatus: 'SUCCEEDED',
          needsVerification: false,
        },
      });
    }, { maxWait: 15000, timeout: 25000 });
    broadcastRealtime('transactions', { action: 'gcash-paid', transactionId: txn.id });
    broadcastRealtime('products', { action: 'stock-updated' });
  } else {
    await prisma.transaction.update({
      where: { id: txn.id },
      data: {
        xenditPaymentId: paymentId ?? txn.xenditPaymentId,
        xenditStatus: normalized,
        needsVerification: true,
      },
    });
    if (normalized === 'FAILED') {
      broadcastRealtime('transactions', { action: 'gcash-failed', transactionId: txn.id });
    }
  }

  return NextResponse.json({ ok: true, transactionId: txn.id, xenditStatus: normalized });
}

// GET /api/webhooks/xendit — health check for dashboard setup / uptime monitors.
export async function GET() {
  return NextResponse.json({ ok: true, webhook: 'xendit', configured: Boolean(process.env.XENDIT_SECRET_KEY) });
}
