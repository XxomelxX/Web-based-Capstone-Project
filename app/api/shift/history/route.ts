import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
        },
      },
    },
  });

  return NextResponse.json({ shifts });
}
