import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/require-role';

export async function GET() {
  const expenses = await prisma.expense.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(expenses);
}

export async function POST(request: Request) {
  const guard = await requireRole(['admin']);
  if (guard) return guard;

  const { type, amount, period, note } = await request.json();
  if (!type || !amount || !period) {
    return NextResponse.json({ error: 'type, amount, and period are required' }, { status: 400 });
  }

  const expense = await prisma.expense.create({
    data: { type, amount: Number(amount), period, note: note ?? null },
  });
  return NextResponse.json(expense, { status: 201 });
}
