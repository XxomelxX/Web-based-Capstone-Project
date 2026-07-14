import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const logs = await prisma.itemLog.findMany({
    include: { product: true, user: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return NextResponse.json(logs);
}
