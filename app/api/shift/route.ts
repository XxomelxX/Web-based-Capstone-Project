import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { getDrawerFloat } from '@/lib/server/shiftDrawer';
import { sumShiftCash, computeExpectedCash } from '@/lib/server/shiftCash';

// GET /api/shift — Fetch active open shift for the logged-in cashier
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = Number(session.user.id);

  // Find open shift for this user
  const activeShift = await prisma.shift.findFirst({
    where: {
      cashierId: userId,
      status: 'open',
    },
    orderBy: { openedAt: 'desc' },
  });

  if (!activeShift) {
    return NextResponse.json({ activeShift: null });
  }

  // Calculate live shift sales (transactions created during this open shift)
  const shiftTransactions = await prisma.transaction.findMany({
    where: {
      cashierId: userId,
      createdAt: { gte: activeShift.openedAt },
      status: 'complete',
    },
    select: {
      paymentMethod: true,
      total: true,
    },
  });

  let cashSales = 0;
  let gcashSales = 0;

  for (const tx of shiftTransactions) {
    if (tx.paymentMethod === 'cash') {
      cashSales += tx.total;
    } else if (tx.paymentMethod === 'gcash') {
      gcashSales += tx.total;
    }
  }

  const totalSales = cashSales + gcashSales;
  // Shared drawer: expected cash = admin's drawer float + this user's cash
  // sales + cash in − cash out − expenses (see lib/server/shiftCash.ts).
  // The float override is returned so the client shows the drawer float.
  const drawerFloat = await getDrawerFloat(session.user.role, activeShift.openingFloat);
  const cashSums = await sumShiftCash(prisma, activeShift.id);
  const expectedCash = computeExpectedCash(drawerFloat, cashSales, cashSums);

  return NextResponse.json({
    activeShift: {
      ...activeShift,
      openingFloat: drawerFloat,
      cashSales,
      gcashSales,
      totalSales,
      transactionCount: shiftTransactions.length,
      expectedCash,
      cashIn: cashSums.cashIn,
      cashOut: cashSums.cashOut,
      totalExpenses: cashSums.expenses,
    },
  });
}

// POST /api/shift — Open or Close shift (Z-Read Reconciliation)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const body = await request.json();
    const { action, openingFloat, closingCash, notes, clientUuid } = body;

    if (action === 'open') {
      // Idempotency: replay returns the original shift.
      if (clientUuid) {
        const replayed = await prisma.shift.findUnique({ where: { clientUuid } });
        if (replayed) return NextResponse.json({ success: true, shift: replayed });
      }
      // Check if cashier already has an open shift
      const existingOpenShift = await prisma.shift.findFirst({
        where: {
          cashierId: userId,
          status: 'open',
        },
      });

      if (existingOpenShift) {
        return NextResponse.json(
          { error: 'You already have an active open shift', shift: existingOpenShift },
          { status: 409 }
        );
      }

      const floatAmount = Number(openingFloat);
      if (!Number.isInteger(floatAmount) || floatAmount < 0) {
        return NextResponse.json({ error: 'openingFloat must be a non-negative integer in centavos' }, { status: 400 });
      }

      try {
        const newShift = await prisma.shift.create({
          data: {
            clientUuid: clientUuid ?? undefined,
            cashierId: userId,
            openingFloat: floatAmount,
            status: 'open',
            notes: notes ?? null,
          },
        });

        return NextResponse.json({ success: true, shift: newShift });
      } catch (createErr) {
        // Concurrent double-open race: return the winner instead of 500.
        if (clientUuid && typeof createErr === 'object' && createErr !== null && 'code' in createErr && (createErr as { code: string }).code === 'P2002') {
          const replayed = await prisma.shift.findUnique({ where: { clientUuid } });
          if (replayed) return NextResponse.json({ success: true, shift: replayed });
        }
        throw createErr;
      }
    }

    if (action === 'close') {
      // Idempotency: replay returns the original closed shift + summary.
      if (clientUuid) {
        const replayed = await prisma.shift.findUnique({
          where: { clientUuid },
          include: { cashier: { select: { fullName: true, username: true } } },
        });
        if (replayed) {
          return NextResponse.json({
            success: true,
            shift: replayed,
            summary: {
              openedAt: replayed.openedAt,
              closedAt: replayed.closedAt,
              openingFloat: replayed.openingFloat,
              cashSales: replayed.cashSales ?? 0,
              gcashSales: replayed.gcashSales ?? 0,
              totalSales: (replayed.cashSales ?? 0) + (replayed.gcashSales ?? 0),
              transactionCount: 0,
              expectedCash: replayed.expectedCash ?? replayed.openingFloat,
              closingCash: replayed.closingCash,
              overageShortage: replayed.overageShortage,
              // Snapshots persisted at close (empty shift → 0).
              cashIn: replayed.cashIn ?? 0,
              cashOut: replayed.cashOut ?? 0,
              expenses: replayed.totalExpenses ?? 0,
            },
          });
        }
      }
      // Find active shift
      const activeShift = await prisma.shift.findFirst({
        where: {
          cashierId: userId,
          status: 'open',
        },
        orderBy: { openedAt: 'desc' },
      });

      if (!activeShift) {
        return NextResponse.json(
          { error: 'No active open shift found to close' },
          { status: 400 }
        );
      }

      // Fetch all completed transactions for this shift
      const shiftTransactions = await prisma.transaction.findMany({
        where: {
          cashierId: userId,
          createdAt: { gte: activeShift.openedAt },
          status: 'complete',
        },
        select: {
          paymentMethod: true,
          total: true,
        },
      });

      let cashSales = 0;
      let gcashSales = 0;

      for (const tx of shiftTransactions) {
        if (tx.paymentMethod === 'cash') {
          cashSales += tx.total;
        } else if (tx.paymentMethod === 'gcash') {
          gcashSales += tx.total;
        }
      }

      // closingCash is optional: when omitted (no physical drawer count),
      // store null so the shift closes without an over/short variance.
      const hasCountedCash = closingCash !== undefined && closingCash !== null
        && Number.isInteger(Number(closingCash));
      let countCash: number | null = null;
      if (hasCountedCash) {
        countCash = Number(closingCash);
        if (countCash < 0) {
          return NextResponse.json({ error: 'closingCash must be a non-negative integer in centavos' }, { status: 400 });
        }
      }
      // Shared drawer: close against the admin's drawer float (fallback: own
      // float) and persist it so the closed record reconciles in history.
      // Cash movements (cash in/out/expenses) adjust the expected cash; their
      // totals are snapshotted on the shift row so history stays self-contained.
      const drawerFloat = await getDrawerFloat(session.user.role, activeShift.openingFloat);
      const cashSums = await sumShiftCash(prisma, activeShift.id);
      const expectedCash = computeExpectedCash(drawerFloat, cashSales, cashSums);
      const overageShortage = countCash !== null ? countCash - expectedCash : null;

      // Guard against double-close from two devices: only close if still open.
      let closedShift;
      try {
        closedShift = await prisma.shift.update({
          where: { id: activeShift.id },
          data: {
            clientUuid: clientUuid ?? undefined,
            openingFloat: drawerFloat,
            closingCash: countCash,
            expectedCash,
            cashSales,
            gcashSales,
            cashIn: cashSums.cashIn,
            cashOut: cashSums.cashOut,
            totalExpenses: cashSums.expenses,
            overageShortage,
            status: 'closed',
            closedAt: new Date(),
            notes: notes ?? activeShift.notes,
          },
          include: {
            cashier: {
              select: { fullName: true, username: true },
            },
          },
        });
      } catch (updateErr) {
        if (clientUuid && typeof updateErr === 'object' && updateErr !== null && 'code' in updateErr && (updateErr as { code: string }).code === 'P2002') {
          const replayed = await prisma.shift.findUnique({
            where: { clientUuid },
            include: { cashier: { select: { fullName: true, username: true } } },
          });
          if (replayed) return NextResponse.json({ success: true, shift: replayed });
        }
        throw updateErr;
      }

      return NextResponse.json({
        success: true,
        shift: closedShift,
        summary: {
          openedAt: activeShift.openedAt,
          closedAt: closedShift.closedAt,
          openingFloat: drawerFloat,
          cashSales,
          gcashSales,
          totalSales: cashSales + gcashSales,
          transactionCount: shiftTransactions.length,
          expectedCash,
          closingCash: countCash,
          overageShortage,
          cashIn: cashSums.cashIn,
          cashOut: cashSums.cashOut,
          expenses: cashSums.expenses,
        },
      });
    }

    if (action === 'verify') {
      if (session.user.role !== 'admin') {
        return NextResponse.json({ error: 'Unauthorized. Admin access required.' }, { status: 403 });
      }

      const { shiftId, verificationStatus, verificationNotes } = body;
      if (!shiftId || !['verified', 'flagged'].includes(verificationStatus)) {
        return NextResponse.json({ error: 'Invalid verification parameters' }, { status: 400 });
      }

      const updatedShift = await prisma.shift.update({
        where: { id: Number(shiftId) },
        data: {
          verifiedBy: userId,
          verifiedAt: new Date(),
          verificationStatus,
          verificationNotes: verificationNotes ?? null,
        },
      });

      return NextResponse.json({ success: true, shift: updatedShift });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
