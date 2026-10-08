import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';

// POST /api/void-requests/:id/cancel — requester (or admin) cancels a pending request.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const requestId = Number(idParam);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    }

    const voidRequest = await prisma.voidRequest.findUnique({ where: { id: requestId } });
    if (!voidRequest) return NextResponse.json({ error: 'Void request not found' }, { status: 404 });
    if (voidRequest.status !== 'pending') {
      return NextResponse.json({ error: `Request already ${voidRequest.status}` }, { status: 409 });
    }

    const userId = Number(session.user.id);
    const role = (session.user as { role?: string }).role;
    if (voidRequest.requestedBy !== userId && role !== 'admin') {
      return NextResponse.json({ error: 'Only the requester or an admin can cancel' }, { status: 403 });
    }

    const cancelled = await prisma.voidRequest.update({
      where: { id: requestId },
      data: { status: 'cancelled', reviewedAt: new Date() },
    });
    broadcastRealtime('transactions', { action: 'void-cancelled', request: cancelled });
    return NextResponse.json(cancelled);
  } catch (err) {
    console.error('[POST /api/void-requests/:id/cancel]', err);
    return NextResponse.json({ error: 'Failed to cancel void request' }, { status: 500 });
  }
}
