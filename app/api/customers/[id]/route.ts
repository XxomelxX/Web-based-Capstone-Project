import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { broadcastRealtime } from '@/lib/realtime';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { id: idParam } = await params;
    const id = Number(idParam);
    const { adminUsername, adminPassword } = await request.json();

    if (!adminUsername || !adminPassword) {
      return NextResponse.json({ error: 'Admin credentials are required to delete a customer.' }, { status: 403 });
    }

    const adminUser = await prisma.user.findUnique({
      where: { username: adminUsername },
    });

    if (!adminUser || adminUser.status !== 'active' || adminUser.role !== 'admin') {
      return NextResponse.json({ error: 'Invalid admin credentials.' }, { status: 403 });
    }

    const compare = (await import('bcryptjs')).compare;
    const isValid = await compare(adminPassword, adminUser.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid admin password.' }, { status: 403 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { utangEntries: { where: { status: { in: ['unpaid', 'partial'] } } } },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }

    if (customer.utangEntries.length > 0) {
      return NextResponse.json({ error: 'Cannot delete customer with outstanding utang. Collect all payments first.' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      const entryIds = (await tx.utangEntry.findMany({
        where: { customerId: id },
        select: { id: true },
      })).map((e) => e.id);

      if (entryIds.length > 0) {
        await tx.paymentAllocation.deleteMany({
          where: { utangEntryId: { in: entryIds } },
        });
      }
      await tx.utangEntryItem.deleteMany({
        where: { utangEntry: { customerId: id } },
      });
      await tx.utangEntry.deleteMany({ where: { customerId: id } });
      await tx.customer.delete({ where: { id } });
    });

    broadcastRealtime('customers', { action: 'deleted', customerId: id });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
