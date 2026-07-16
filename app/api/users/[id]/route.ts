import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';

// PATCH /api/users/:id — update user fields (e.g. status: 'inactive' for deactivation)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { id: idParam } = await params;
  const id = Number(idParam);
  const data = await request.json();

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(data.status !== undefined && { status: data.status }),
      ...(data.role !== undefined && { role: data.role }),
      ...(data.fullName !== undefined && { fullName: data.fullName }),
    },
    select: { id: true, fullName: true, username: true, email: true, role: true, status: true, createdAt: true },
  });

  broadcastRealtime('users', { action: 'updated', user });
  return NextResponse.json(user);
}

// DELETE /api/users/:id — hard delete only if user has zero linked history
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
}
