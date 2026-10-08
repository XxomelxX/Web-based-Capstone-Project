import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { executeVoidTransaction } from '@/lib/server/void-transaction';

// POST /api/void-requests/:id/review  body: { approved: boolean, note? }
// Admin only. Approving executes the void (shared implementation).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if ((session.user as { role?: string }).role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const requestId = Number(idParam);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    }

    const body = await request.json().catch(() => null) as { approved?: unknown; note?: unknown } | null;
    const approved = body?.approved === true;
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null;
    const reviewerId = Number(session.user.id);

    const voidRequest = await prisma.voidRequest.findUnique({ where: { id: requestId } });
    if (!voidRequest) return NextResponse.json({ error: 'Void request not found' }, { status: 404 });
    if (voidRequest.status !== 'pending') {
      return NextResponse.json({ error: `Request already ${voidRequest.status}`, status: voidRequest.status }, { status: 409 });
    }

    if (!approved) {
      const rejected = await prisma.voidRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note },
      });
      broadcastRealtime('transactions', { action: 'void-rejected', request: rejected });
      return NextResponse.json(rejected);
    }

    const result = await executeVoidTransaction(voidRequest.transactionId, voidRequest.reason, reviewerId);
    const approvedReq = await prisma.voidRequest.update({
      where: { id: requestId },
      data: { status: 'approved', reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note },
    });

    broadcastRealtime('transactions', { action: 'voided', transaction: result });
    broadcastRealtime('products', { action: 'stock-updated' });
    return NextResponse.json({ request: approvedReq, transaction: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Review failed';
    console.error('[POST /api/void-requests/:id/review]', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
