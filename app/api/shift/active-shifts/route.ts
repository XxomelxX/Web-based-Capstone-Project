import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { computeExpectedCash } from '@/lib/server/shiftCash';

// GET /api/shift/active-shifts — Admin Spot check monitoring of all open cash drawers (X-Read)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized. Admin access required.' }, { status: 403 });
  }

  try {
    // Find all active open shifts
    const openShifts = await prisma.shift.findMany({
      where: {
        status: 'open',
      },
      include: {
        cashier: {
          select: {
            fullName: true,
            username: true,
            role: true,
          },
        },
      },
      orderBy: { openedAt: 'desc' },
    });
    if (openShifts.length === 0) {
      return NextResponse.json({ activeShifts: [] });
    }

    // Batched X-read: the per-shift loop used to fire 3 sequential queries per
    // open shift (findMany + drawer float + cash sums) — seconds of round
    // trips on a high-RTT link. Two flat queries + JS bucketing is equivalent:
    // - shared drawer: newest ADMIN open shift's float (from openShifts),
    // - per-shift sales bucketed by cashierId/createdAt,
    // - per-shift movement sums bucketed by shiftId.
    const adminFloat = openShifts.find((s) => s.cashier.role === 'admin')?.openingFloat ?? null;
    const minOpened = openShifts.reduce((m, s) => (s.openedAt < m ? s.openedAt : m), openShifts[0].openedAt);
    const shiftIds = openShifts.map((s) => s.id);

    const [txRows, movementRows, paymentRows] = await Promise.all([
      prisma.transaction.findMany({
        where: { status: 'complete', createdAt: { gte: minOpened } },
        select: { cashierId: true, paymentMethod: true, total: true, createdAt: true },
      }),
      prisma.cashMovement.findMany({
        where: { shiftId: { in: shiftIds } },
        select: { shiftId: true, type: true, amount: true },
      }),
      // Customer-debt payments collected in cash are drawer money too.
      prisma.payment.findMany({
        where: { recordedBy: { in: [...new Set(openShifts.map((s) => s.cashierId))] }, createdAt: { gte: minOpened } },
        select: {
          recordedBy: true,
          createdAt: true,
          allocations: { select: { amountApplied: true } },
        },
      }),
    ]);

    // Per-shift sales totals (double-open is guarded upstream, so one open
    // shift per cashier — bucket by cashierId with THAT shift's openedAt
    // boundary so sales from this cashier's already-closed prior shifts are
    // not attributed to the current X-read).
    const openByCashier = new Map<number, Date>();
    openShifts.forEach((s) => openByCashier.set(s.cashierId, s.openedAt));
    const txTotalsByCashier = new Map<number, { cash: number; gcash: number; count: number }>();
    for (const tx of txRows) {
      if (tx.paymentMethod !== 'cash' && tx.paymentMethod !== 'gcash') continue;
      const openedAt = openByCashier.get(tx.cashierId);
      if (openedAt && tx.createdAt < openedAt) continue; // predates this shift window
      let row = txTotalsByCashier.get(tx.cashierId);
      if (!row) { row = { cash: 0, gcash: 0, count: 0 }; txTotalsByCashier.set(tx.cashierId, row); }
      if (tx.paymentMethod === 'cash') row.cash += tx.total; else row.gcash += tx.total;
      row.count += 1;
    }

    const sumsByShift = new Map<number, { cashIn: number; cashOut: number; expenses: number }>();
    for (const m of movementRows) {
      let sums = sumsByShift.get(m.shiftId);
      if (!sums) { sums = { cashIn: 0, cashOut: 0, expenses: 0 }; sumsByShift.set(m.shiftId, sums); }
      if (m.type === 'cash_in') sums.cashIn += m.amount;
      else if (m.type === 'cash_out') sums.cashOut += m.amount;
      else if (m.type === 'expense') sums.expenses += m.amount;
    }

    // Debt payments per cashier, bucketed the same way as the sales: only the
    // payments inside THIS shift's window count (the net cash that settled a
    // debt — the part that stayed in the drawer).
    const debtByCashier = new Map<number, { at: Date; amount: number }[]>();
    for (const p of paymentRows) {
      if (p.recordedBy === null) continue;
      const amount = p.allocations.reduce((s, a) => s + a.amountApplied, 0);
      if (amount <= 0) continue;
      const list = debtByCashier.get(p.recordedBy) ?? [];
      list.push({ at: p.createdAt, amount });
      debtByCashier.set(p.recordedBy, list);
    }

    const activeShiftsWithTotals = openShifts.map((shift) => {
      const totals = txTotalsByCashier.get(shift.cashierId) ?? { cash: 0, gcash: 0, count: 0 };
      const cashSales = totals.cash;
      const gcashSales = totals.gcash;
      const totalSales = cashSales + gcashSales;
      const sums = sumsByShift.get(shift.id) ?? { cashIn: 0, cashOut: 0, expenses: 0 };
      const drawerFloat = shift.cashier.role === 'admin' ? shift.openingFloat : (adminFloat ?? shift.openingFloat);
      const debtPayments = (debtByCashier.get(shift.cashierId) ?? [])
        .filter((p) => p.at >= shift.openedAt)
        .reduce((s, p) => s + p.amount, 0);
      const expectedCash = computeExpectedCash(drawerFloat, cashSales, sums, debtPayments);
      return {
        id: shift.id,
        cashierId: shift.cashierId,
        cashier: shift.cashier,
        openingFloat: drawerFloat,
        status: shift.status,
        openedAt: shift.openedAt,
        notes: shift.notes,
        cashSales,
        gcashSales,
        totalSales,
        expectedCash,
        cashIn: sums.cashIn,
        cashOut: sums.cashOut,
        totalExpenses: sums.expenses,
        debtPayments,
        transactionCount: totals.count,
      };
    });

    return NextResponse.json({ activeShifts: activeShiftsWithTotals });
  } catch (error) {
    console.error('Error fetching active shifts spot check:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
