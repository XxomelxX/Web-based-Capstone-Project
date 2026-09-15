import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireRole } from '@/lib/server/require-role';
import { requireSession } from '@/lib/server/require-session';
import { broadcastRealtime } from '@/lib/server/realtime';

export async function GET() {
  const guard = await requireSession();
  if (guard) return guard;

  let settings = await prisma.settings.findFirst();
  if (!settings) {
    settings = await prisma.settings.create({ data: {} });
  }
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const raw = await request.json();
  const data: Record<string, unknown> = {};
  if ('storeName' in raw) data.storeName = String(raw.storeName);
  if ('currency' in raw) data.currency = String(raw.currency);
  if ('address' in raw) data.address = String(raw.address);
  if ('taxRate' in raw) data.taxRate = Number(raw.taxRate);
  if ('lowStockThreshold' in raw) data.lowStockThreshold = Number(raw.lowStockThreshold);

  const existing = await prisma.settings.findFirst();

  const settings = existing
    ? await prisma.settings.update({ where: { id: existing.id }, data })
    : await prisma.settings.create({ data });

  broadcastRealtime('settings', { action: 'updated', settings });
  return NextResponse.json(settings);
}
