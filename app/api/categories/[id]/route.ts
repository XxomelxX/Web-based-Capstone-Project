import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';

// PATCH /api/categories/:id — edit name, description, archived
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { id: idParam } = await params;
  const id = Number(idParam);
  const data = await request.json();

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.archived !== undefined && { archived: Boolean(data.archived) }),
    },
  });

  broadcastRealtime('categories', { action: 'updated', category });
  return NextResponse.json(category);
}

// DELETE /api/categories/:id — only if zero products are linked
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { id: idParam } = await params;
  const id = Number(idParam);

  const productCount = await prisma.product.count({ where: { categoryId: id } });
  if (productCount > 0) {
    return NextResponse.json(
      { error: "Can't delete — reassign or remove its products first." },
      { status: 409 }
    );
  }

  await prisma.category.delete({ where: { id } });
  broadcastRealtime('categories', { action: 'deleted', id });
  return NextResponse.json({ success: true });
}
