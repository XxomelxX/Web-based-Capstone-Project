import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';
import { hash } from 'bcryptjs';

// PATCH /api/users/:id — update user fields (e.g. status: 'inactive' for deactivation)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRole(['admin']);
    if (guard) return guard;

    const { id: idParam } = await params;
    const id = Number(idParam);
    const data = await request.json();

    const updateData: Record<string, unknown> = {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.role !== undefined && { role: data.role }),
      ...(data.status !== undefined && { status: data.status }),
    };

    if (data.newPassword) {
      updateData.passwordHash = await hash(data.newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, fullName: true, username: true, email: true, role: true, status: true, createdAt: true },
    });

    broadcastRealtime('users', { action: 'updated', user });
    return NextResponse.json(user);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}

// DELETE /api/users/:id — hard delete only if user has zero linked history
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRole(['admin']);
    if (guard) return guard;

    const { id: idParam } = await params;
    const id = Number(idParam);

    // Check for linked records
    const [transactions, itemLogs] = await Promise.all([
      prisma.transaction.count({ where: { cashierId: id } }),
      prisma.itemLog.count({ where: { performedBy: id } }),
    ]);

    if (transactions + itemLogs > 0) {
      return NextResponse.json(
        { error: 'This user has transaction history — deactivate instead of deleting', canDeactivate: true },
        { status: 409 }
      );
    }

    await prisma.user.delete({ where: { id } });
    broadcastRealtime('users', { action: 'deleted', id });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Record to delete does not exist')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
