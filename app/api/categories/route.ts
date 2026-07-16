import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';

export async function GET() {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { name, description } = await request.json();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const category = await prisma.category.create({ data: { name, description } });
  broadcastRealtime('categories', { action: 'created', category });
  return NextResponse.json(category, { status: 201 });
}
