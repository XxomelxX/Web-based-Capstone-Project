import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';

export async function GET() {
  const products = await prisma.product.findMany({
    where: { archived: false },
    include: { category: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(products);
}

export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const data = await request.json();

  if (!data.name || !data.categoryId || data.price == null || data.stock == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const product = await prisma.product.create({
    data: {
      name: data.name,
      categoryId: Number(data.categoryId),
      price: Number(data.price),
      cost: Number(data.cost ?? 0),
      stock: Number(data.stock),
      packSize: data.packSize ?? null,
      unit: data.unit ?? null,
      barcode: data.barcode ?? null,
    },
  });

  return NextResponse.json(product, { status: 201 });
}
