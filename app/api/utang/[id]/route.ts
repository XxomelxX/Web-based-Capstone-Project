import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';

// PATCH /api/utang/:id  body: { dueDate?: string | null }
// Set, change, or clear (null) a debt's custom deadline. Any authenticated
// user (cashier collecting, admin managing) may edit. Backdating/distant
// dates allowed here so corrections are possible; creation rejects the past.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const entryId = Number(idParam);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return NextResponse.json({ error: 'Invalid entry id' }, { status: 400 });
    }

    const body = await request.json().catch(() => null) as { dueDate?: unknown } | null;
    if (!body || !('dueDate' in body)) {
      return NextResponse.json({ error: 'dueDate is required (ISO datetime or null to clear)' }, { status: 400 });
    }

    let dueDate: Date | null = null;
    if (body.dueDate !== null && body.dueDate !== '') {
      if (typeof body.dueDate !== 'string') {
        return NextResponse.json({ error: 'Invalid dueDate' }, { status: 400 });
      }
      const parsed = new Date(body.dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid dueDate' }, { status: 400 });
      }
      dueDate = parsed;
    }

    const existing = await prisma.utangEntry.findUnique({ where: { id: entryId } });
    if (!existing) return NextResponse.json({ error: 'Utang entry not found' }, { status: 404 });

    const updated = await prisma.utangEntry.update({
      where: { id: entryId },
      data: { dueDate },
      include: { customer: true, items: { include: { product: true } }, paymentAllocations: { include: { payment: true } } },
    });

    broadcastRealtime('utang', { action: 'deadline-updated', entry: updated });
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[PATCH /api/utang/:id]', err);
    return NextResponse.json({ error: 'Failed to update deadline' }, { status: 500 });
  }
}
