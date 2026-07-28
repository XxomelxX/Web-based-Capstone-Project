import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
  const expectedCash = activeShift.openingFloat + cashSales;

  return NextResponse.json({
    activeShift: {
      ...activeShift,
      cashSales,
      gcashSales,
      totalSales,
      transactionCount: shiftTransactions.length,
      expectedCash,
    },
  });
}

// POST /api/shift — Open or Close shift (Z-Read Reconciliation)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = Number(session.user.id);
  const body = await request.json();
  const { action, openingFloat, closingCash, notes } = body;

  if (action === 'open') {
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
        { status: 400 }
      );
    }

    const floatAmount = Number(openingFloat) || 0;

    const newShift = await prisma.shift.create({
      data: {
        cashierId: userId,
        openingFloat: floatAmount,
        status: 'open',
        notes: notes ?? null,
      },
    });

    return NextResponse.json({ success: true, shift: newShift });
  }

  if (action === 'close') {
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

    const countCash = Number(closingCash) || 0;
    const expectedCash = activeShift.openingFloat + cashSales;
    const overageShortage = countCash - expectedCash;

    const closedShift = await prisma.shift.update({
      where: { id: activeShift.id },
      data: {
        closingCash: countCash,
        expectedCash,
        cashSales,
        gcashSales,
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

    return NextResponse.json({
      success: true,
      shift: closedShift,
      summary: {
        openedAt: activeShift.openedAt,
        closedAt: closedShift.closedAt,
        openingFloat: activeShift.openingFloat,
        cashSales,
        gcashSales,
        totalSales: cashSales + gcashSales,
        transactionCount: shiftTransactions.length,
        expectedCash,
        closingCash: countCash,
        overageShortage,
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
}
