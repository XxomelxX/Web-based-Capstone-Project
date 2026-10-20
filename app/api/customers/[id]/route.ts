import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { broadcastRealtime } from '@/lib/server/realtime';
import { verifySupervisor } from '@/lib/server/supervisor';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const data = await request.json();

    if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) {
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
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    let body: { adminUsername?: string; adminPassword?: string; force?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body with admin credentials is required.' }, { status: 400 });
    }
    const { adminUsername, adminPassword, force } = body;

    const gate = await verifySupervisor(adminUsername, adminPassword);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { utangEntries: true },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }

    const outstanding = customer.utangEntries.filter((e) => e.status !== 'paid');
    if (outstanding.length > 0) {
      return NextResponse.json({ error: 'Cannot delete customer with outstanding utang. Collect all payments first, or use force delete.', hasOutstanding: true }, { status: 400 });
    }

    if (customer.utangEntries.length > 0 && !force) {
      return NextResponse.json({ error: 'Customer has credit history. Use force delete to purge history, or keep the record.', hasHistory: true }, { status: 400 });
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
      // Non-force path only reaches here when no outstanding balance remains,
      // but paid history is preserved. Force path purges all history.
      if (force) {
        await tx.utangEntry.deleteMany({ where: { customerId: id } });
      }
      // Detach completed sales so the customer row can be removed.
      await tx.transaction.updateMany({ where: { customerId: id }, data: { customerId: null } });
      await tx.customer.delete({ where: { id } });
    }, { maxWait: 15000, timeout: 25000 });

    broadcastRealtime('customers', { action: 'deleted', customerId: id });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
