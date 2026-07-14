import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';

// PATCH /api/products/:id  — edit fields, or pass { archived: true } to soft-delete
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
    },
  });

  return NextResponse.json(product);
}

// Intentionally NO DELETE handler — products are archived (soft-deleted), never hard-deleted,
// so historical Transactions/StockBatches referencing them stay valid.
