import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';

export async function GET() {
  const guard = await requireSession();
  if (guard) return guard;

  const logs = await prisma.itemLog.findMany({
    include: { product: true, user: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return NextResponse.json(logs);
}
