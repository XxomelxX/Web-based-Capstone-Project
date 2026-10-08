import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';

// POST /api/void-requests  body: { transactionId, reason, clientUuid? }
// Any authenticated user (cashier or admin) can request a void.
// Idempotent by clientUuid; one pending request per transaction.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as {
      transactionId?: unknown; reason?: unknown; clientUuid?: unknown;
    } | null;
    const transactionId = Number(body?.transactionId);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const clientUuid = typeof body?.clientUuid === 'string' ? body.clientUuid : undefined;

    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      return NextResponse.json({ error: 'Valid transactionId is required' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: 'Void reason is required' }, { status: 400 });
    }

    if (clientUuid) {
      const existing = await prisma.voidRequest.findUnique({ where: { clientUuid } });
      if (existing) return NextResponse.json(existing, { status: 200 });
    }

    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    if (txn.status === 'voided') {
      return NextResponse.json({ error: 'Transaction is already voided' }, { status: 400 });
    }

    const pending = await prisma.voidRequest.findFirst({
      where: { transactionId, status: 'pending' },
    });
    if (pending) {
      return NextResponse.json(pending, { status: 200 });
    }

    const created = await prisma.voidRequest.create({
      data: {
        clientUuid,
        transactionId,
        reason,
        requestedBy: Number(session.user.id),
      },
      include: {
        transaction: { include: { cashier: true } },
      },
    });

    broadcastRealtime('transactions', { action: 'void-requested', request: created });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    // Idempotent replay race: unique clientUuid already won.
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Request already submitted' }, { status: 200 });
    }
    console.error('[POST /api/void-requests]', err);
    return NextResponse.json({ error: 'Failed to submit void request' }, { status: 500 });
  }
}

// GET /api/void-requests?status=pending — admin only (approve queue).
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if ((session.user as { role?: string }).role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? 'pending';
    const where = status === 'all' ? {} : { status };

    const requests = await prisma.voidRequest.findMany({
      where,
      include: { transaction: { include: { cashier: true } } },
      orderBy: { requestedAt: 'desc' },
    });
    return NextResponse.json(requests);
  } catch (err) {
    console.error('[GET /api/void-requests]', err);
    return NextResponse.json({ error: 'Failed to load void requests' }, { status: 500 });
  }
}
