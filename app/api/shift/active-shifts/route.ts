import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/shift/active-shifts — Admin Spot check monitoring of all open cash drawers (X-Read)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
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
          },
        },
      },
      orderBy: { openedAt: 'desc' },
    });

    const activeShiftsWithTotals = [];

    for (const shift of openShifts) {
      // Calculate live transactions during this cashier's shift
      const shiftTransactions = await prisma.transaction.findMany({
        where: {
          cashierId: shift.cashierId,
          createdAt: { gte: shift.openedAt },
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
      const expectedCash = shift.openingFloat + cashSales;

      activeShiftsWithTotals.push({
        id: shift.id,
        cashierId: shift.cashierId,
        cashier: shift.cashier,
        openingFloat: shift.openingFloat,
        status: shift.status,
        openedAt: shift.openedAt,
        notes: shift.notes,
        cashSales,
        gcashSales,
        totalSales,
        expectedCash,
        transactionCount: shiftTransactions.length,
      });
    }

    return NextResponse.json({ activeShifts: activeShiftsWithTotals });
  } catch (error) {
    console.error('Error fetching active shifts spot check:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
