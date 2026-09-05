import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';
import { requireSession } from '@/lib/require-session';
import { broadcastRealtime } from '@/lib/realtime';

export async function GET() {
  const guard = await requireSession();
  if (guard) return guard;

  const expenses = await prisma.expense.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(expenses);
}

export async function POST(request: Request) {
  try {
    const guard = await requireRole(['admin']);
    if (guard) return guard;

    const { type, amount, period, note } = await request.json();
    if (!type || !amount || !period) {
      return NextResponse.json({ error: 'type, amount, and period are required' }, { status: 400 });
    }

    if (Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
    }

    const expense = await prisma.expense.create({
      data: { type, amount: Number(amount), period, note: note ?? null },
    });

    broadcastRealtime('expenses', { action: 'created', expense });
    return NextResponse.json(expense, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
