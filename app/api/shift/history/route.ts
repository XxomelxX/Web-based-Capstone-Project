import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { getAdminOpenFloat } from '@/lib/server/shiftDrawer';

// GET /api/shift/history — Fetch shift logs for reporting / audit
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = Number(session.user.id);
  const role = session.user.role;

  // Admins see all shifts; cashiers see their own shift history
  const whereCondition = role === 'admin' ? {} : { cashierId: userId };

  const shifts = await prisma.shift.findMany({
    where: whereCondition,
    orderBy: { openedAt: 'desc' },
    take: 50,
    include: {
      cashier: {
        select: {
          fullName: true,
          username: true,
          role: true,
        },
      },
    },
  });

  // Shared drawer: still-open cashier shifts display the admin's current
  // drawer float (closed shifts already stored it at close time).
  const adminOpenFloat = await getAdminOpenFloat();
  const shiftsOut = adminOpenFloat === null
    ? shifts
    : shifts.map((s) => {
        if (s.status !== 'open' || s.cashier.role === 'admin') return s;
        return { ...s, openingFloat: adminOpenFloat };
      });

  return NextResponse.json({ shifts: shiftsOut });
}
