import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';

// PATCH /api/products/:id  — edit fields, or pass { archived: true/false } to toggle archive
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRole(['admin']);
    if (guard) return guard;

    const { id: idParam } = await params;
    const id = Number(idParam);
    const data = await request.json();

    if (data.price !== undefined && Number(data.price) < 0) {
      return NextResponse.json({ error: 'Price cannot be negative' }, { status: 400 });
    }
    if (data.cost !== undefined && Number(data.cost) < 0) {
      return NextResponse.json({ error: 'Cost cannot be negative' }, { status: 400 });
    }
    if (data.stock !== undefined && Number(data.stock) < 0) {
      return NextResponse.json({ error: 'Stock cannot be negative' }, { status: 400 });
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.categoryId !== undefined && { categoryId: Number(data.categoryId) }),
        ...(data.price !== undefined && { price: Number(data.price) }),
        ...(data.cost !== undefined && { cost: Number(data.cost) }),
        ...(data.stock !== undefined && { stock: Number(data.stock) }),
        ...(data.packSize !== undefined && { packSize: data.packSize }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.barcode !== undefined && { barcode: data.barcode }),
        ...(data.archived !== undefined && { archived: Boolean(data.archived) }),
        ...(data.goodsType !== undefined && { goodsType: data.goodsType }),
        ...(data.vatType !== undefined && { vatType: data.vatType }),
        ...(data.expiryDate !== undefined && { expiryDate: data.expiryDate ? new Date(data.expiryDate) : null }),
      },
    });

    broadcastRealtime('products', { action: 'updated', product });
    return NextResponse.json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json({ error: 'Invalid category reference.' }, { status: 400 });
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

    const [txItems, utangItems, stockBatches, itemLogs] = await Promise.all([
      prisma.transactionItem.count({ where: { productId: id } }),
      prisma.utangEntryItem.count({ where: { productId: id } }),
      prisma.stockBatch.count({ where: { productId: id } }),
      prisma.itemLog.count({ where: { productId: id } }),
    ]);

    if (txItems + utangItems + stockBatches + itemLogs > 0) {
      return NextResponse.json(
        { error: "Can't delete — this product has sales history. Archive it instead." },
        { status: 409 }
      );
    }

    await prisma.product.delete({ where: { id } });
    broadcastRealtime('products', { action: 'deleted', id });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
