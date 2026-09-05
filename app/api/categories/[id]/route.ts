import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') {
        return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
      }
      if (err.code === 'P2003') {
        return NextResponse.json(
          { error: "Can't delete — reassign or remove its products first." },
          { status: 400 }
        );
      }
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
