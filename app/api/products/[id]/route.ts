import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { broadcastRealtime } from '@/lib/realtime';

// PATCH /api/products/:id  — edit fields, or pass { archived: true/false } to toggle archive
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { id: idParam } = await params;
  const id = Number(idParam);
  const data = await request.json();

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
    },
  });

  broadcastRealtime('products', { action: 'updated', product });
  return NextResponse.json(product);
}

// DELETE /api/products/:id  — only allowed if the product has zero linked history
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { id: idParam } = await params;
  const id = Number(idParam);

  // Check for linked records
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
}
