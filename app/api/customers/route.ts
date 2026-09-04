import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastRealtime } from '@/lib/realtime';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const light = searchParams.get('light') === 'true';

  if (light) {
    const customers = await prisma.customer.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(customers);
  }

  const customers = await prisma.customer.findMany({
    include: {
      transactions: {
        include: {
          items: {
            include: { product: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      utangEntries: {
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(customers);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { name, phone, email, notes } = body as {
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
  };

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
  }

  const existing = await prisma.customer.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
  });
  if (existing) {
    return NextResponse.json(existing);
  }

  const customer = await prisma.customer.create({
    data: {
      name: name.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      notes: notes?.trim() || null,
    },
  });

  broadcastRealtime('customers', { action: 'created', customer });

  return NextResponse.json(customer, { status: 201 });
}
