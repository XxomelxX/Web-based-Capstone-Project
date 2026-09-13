import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';

// GET /api/sync/pull?since=ISO — delta sync (blog §9 pullChanges).
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since');
  const where = since ? { updatedAt: { gt: new Date(since) } } : {};
  const products = await prisma.product.findMany({ where, take: 500, include: { category: true } });
  return NextResponse.json({ products, syncedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
