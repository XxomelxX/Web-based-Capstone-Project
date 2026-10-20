import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireRole } from '@/lib/server/require-role';
import { requireAdmin } from '@/lib/server/require-session';
import { broadcastRealtime } from '@/lib/server/realtime';

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const expenses = await prisma.expense.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(expenses);
}

export async function POST(request: Request) {
  try {
    const guard = await requireRole(['admin']);
    if (guard) return guard;

    const { type, amount, period, note } = await request.json();
    if (!type || typeof type !== 'string' || !type.trim() || !period || typeof period !== 'string' || !period.trim()) {
      return NextResponse.json({ error: 'type, amount, and period are required' }, { status: 400 });
    }

    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive integer in centavos' }, { status: 400 });
    }

    const expense = await prisma.expense.create({
      data: { type: type.trim(), amount: amt, period: period.trim(), note: note ?? null },
    });

    broadcastRealtime('expenses', { action: 'created', expense });
    return NextResponse.json(expense, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
