import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { requireRole } from '@/lib/server/require-role';
import { broadcastRealtime } from '@/lib/server/realtime';
import { sumShiftCash, computeExpectedCash } from '@/lib/server/shiftCash';
import { getDrawerFloat } from '@/lib/server/shiftDrawer';

// Cash movements recorded against the caller's OPEN shift:
//   GET    /api/shift/cash-movement — latest 50 movements on the open shift
//   POST   /api/shift/cash-movement — record cash_in / cash_out / expense
//   DELETE /api/shift/cash-movement?id=N — admin-only correction (also removes
//          the dual-written Expense row for type='expense')
//
// The target shift is always resolved server-side as the recorder's current
// open shift — never trusted from the payload. Offline the queue replays
// open_shift first (FIFO), so by the time a cash_movement action replays the
// real shift exists, even though the client queued it against a temp id.
//
// Expenses dual-write an Expense row so the store-wide Expenses page and
// profit reports include drawer spending. expectedCash everywhere =
// float + cashSales + cashIn − cashOut − expenses (lib/server/shiftCash.ts).

const MOVEMENT_TYPES = ['cash_in', 'cash_out', 'expense'] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

function isMovementType(value: unknown): value is MovementType {
  return typeof value === 'string' && (MOVEMENT_TYPES as readonly string[]).includes(value);
}

async function requireOpenShift(userId: number) {
  return prisma.shift.findFirst({
    where: { cashierId: userId, status: 'open' },
    orderBy: { openedAt: 'desc' },
  });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = Number(session.user.id);

  const shift = await requireOpenShift(userId);
  if (!shift) {
    return NextResponse.json({ movements: [] });
  }

  const movements = await prisma.cashMovement.findMany({
    where: { shiftId: shift.id },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ movements });
}

export async function POST(request: Request) {
  let retryClientUuid: string | undefined;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = Number(session.user.id);

    const { type, amount, note, clientUuid } = await request.json();

    if (!isMovementType(type)) {
      return NextResponse.json({ error: 'type must be "cash_in", "cash_out" or "expense"' }, { status: 400 });
    }
    const amountCents = Number(amount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: 'amount must be a positive integer in centavos' }, { status: 400 });
    }
    const noteText = note ? String(note).slice(0, 200).trim() : null;
    retryClientUuid = typeof clientUuid === 'string' && clientUuid ? clientUuid : undefined;

    // Idempotency: replay of a queued/failed request returns the original row.
    if (retryClientUuid) {
      const replayed = await prisma.cashMovement.findUnique({
        where: { clientUuid: retryClientUuid },
        include: { user: { select: { fullName: true } } },
      });
      if (replayed) return NextResponse.json({ movement: replayed, replayed: true });
    }

    const shift = await requireOpenShift(userId);
    if (!shift) {
      return NextResponse.json({ error: 'No open shift — open a shift before recording cash movements' }, { status: 400 });
    }

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.cashMovement.create({
        data: {
          clientUuid: retryClientUuid,
          shiftId: shift.id,
          type,
          amount: amountCents,
          note: noteText,
          performedBy: userId,
        },
      });
      if (type === 'expense') {
        // Dual-write so store reports (Expenses page, profit) include it.
        const expense = await tx.expense.create({
          data: {
            type: 'Shift Expense',
            amount: amountCents,
            period: new Date().toISOString().slice(0, 10),
            note: noteText,
          },
        });
        return tx.cashMovement.update({
          where: { id: created.id },
          data: { expenseId: expense.id },
          include: { user: { select: { fullName: true } } },
        });
      }
      return tx.cashMovement.findUnique({
        where: { id: created.id },
        include: { user: { select: { fullName: true } } },
      });
    }, { maxWait: 15000, timeout: 25000 });

    // Live totals for the caller's shift bar (shared-drawer float included).
    const sums = await sumShiftCash(prisma, shift.id);
    const drawerFloat = await getDrawerFloat(session.user.role, shift.openingFloat);

    broadcastRealtime('shift', { action: 'cash-movement', shiftId: shift.id });
    if (type === 'expense') broadcastRealtime('expenses', { action: 'created' });

    return NextResponse.json({
      movement,
      totals: { ...sums, expectedCash: computeExpectedCash(drawerFloat, 0, sums) },
    });
  } catch (err) {
    // Concurrent clientUuid replay raced the create: return the winner's row
    // so the client can store it (same contract as void-requests).
    if (retryClientUuid && typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      const existing = await prisma.cashMovement.findUnique({
        where: { clientUuid: retryClientUuid },
        include: { user: { select: { fullName: true } } },
      }).catch(() => null);
      if (existing) return NextResponse.json({ movement: existing, replayed: true });
    }
    console.error('[POST /api/shift/cash-movement]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to record cash movement' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const session = await getServerSession(authOptions);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  try {
    const movement = await prisma.cashMovement.findUnique({ where: { id } });
    if (!movement) {
      return NextResponse.json({ error: 'Cash movement not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      if (movement.expenseId) {
        await tx.expense.delete({ where: { id: movement.expenseId } });
      }
      await tx.cashMovement.delete({ where: { id } });
    }, { maxWait: 15000, timeout: 25000 });

    broadcastRealtime('shift', { action: 'cash-movement', shiftId: movement.shiftId });
    if (movement.type === 'expense') broadcastRealtime('expenses', { action: 'deleted' });

    return NextResponse.json({ success: true, deletedBy: Number(session?.user.id) || null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete cash movement' },
      { status: 400 }
    );
  }
}
