import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';

export async function GET() {
  let settings = await prisma.settings.findFirst();
  if (!settings) {
    settings = await prisma.settings.create({ data: {} });
  }
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const data = await request.json();
  const existing = await prisma.settings.findFirst();

  const settings = existing
    ? await prisma.settings.update({ where: { id: existing.id }, data })
    : await prisma.settings.create({ data });

  return NextResponse.json(settings);
}
