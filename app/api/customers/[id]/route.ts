import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcastRealtime } from '@/lib/realtime';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  const data = await request.json();

  if (data.name !== undefined && typeof data.name !== 'string') {
    return NextResponse.json({ error: 'Invalid customer name' }, { status: 400 });
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
      ...(data.email !== undefined && { email: data.email?.trim() || null }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
  });

  broadcastRealtime('customers', { action: 'updated', customer });

  return NextResponse.json(customer);
}
