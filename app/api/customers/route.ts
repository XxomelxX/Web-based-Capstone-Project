import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcastRealtime } from '@/lib/realtime';

export async function GET() {
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
