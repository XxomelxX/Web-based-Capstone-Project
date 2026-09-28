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
  if ('taxRate' in raw) {
    const v = Number(raw.taxRate);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return NextResponse.json({ error: 'taxRate must be between 0 and 100' }, { status: 400 });
    }
    data.taxRate = v;
  }
  if ('lowStockThreshold' in raw) {
    const v = Number(raw.lowStockThreshold);
    if (!Number.isInteger(v) || v < 0) {
      return NextResponse.json({ error: 'lowStockThreshold must be a non-negative integer' }, { status: 400 });
    }
    data.lowStockThreshold = v;
  }

  const existing = await prisma.settings.findFirst();

  const settings = existing
    ? await prisma.settings.update({ where: { id: existing.id }, data })
    : await prisma.settings.create({ data });

  broadcastRealtime('settings', { action: 'updated', settings });
  return NextResponse.json(settings);
}
