import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/require-session';

export async function GET(request: Request) {
  const guard = await requireSession();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') ?? 'all';

  const now = new Date();
  let since: Date | undefined;
  if (range === 'week') {
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === 'month') {
    since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const whereClause = {
    status: 'complete' as const,
    ...(since ? { createdAt: { gte: since } } : {}),
  };

  try {
    const [transactions, expenses] = await Promise.all([
      prisma.transaction.findMany({
        where: whereClause,
        include: { items: { include: { product: { include: { category: true } } } } },
      }),
      prisma.expense.findMany({
        where: since ? { createdAt: { gte: since } } : {},
      }),
    ]);

    // Revenue over time (group by day)
    const revenueByDay: Record<string, { date: string; revenue: number; transactions: number }> = {};
    for (const t of transactions) {
      const day = t.createdAt.toISOString().slice(0, 10);
      if (!revenueByDay[day]) {
        revenueByDay[day] = { date: day, revenue: 0, transactions: 0 };
      }
      revenueByDay[day].revenue += t.total;
      revenueByDay[day].transactions += 1;
    }
    const revenueOverTime = Object.values(revenueByDay).sort((a, b) => a.date.localeCompare(b.date));

    // Payment method breakdown
    const paymentMap: Record<string, { method: string; count: number; total: number }> = {};
    for (const t of transactions) {
      const key = t.paymentMethod;
      if (!paymentMap[key]) {
        paymentMap[key] = { method: key, count: 0, total: 0 };
      }
      paymentMap[key].count += 1;
      paymentMap[key].total += t.total;
    }
    const paymentMethods = Object.values(paymentMap);

    // Sales by category
    const categoryMap: Record<string, { category: string; revenue: number; items: number }> = {};
    for (const t of transactions) {
      for (const item of t.items) {
        const catName = item.product.category?.name ?? 'Uncategorized';
        if (!categoryMap[catName]) {
          categoryMap[catName] = { category: catName, revenue: 0, items: 0 };
        }
        categoryMap[catName].revenue += item.lineTotal;
        categoryMap[catName].items += item.quantity;
      }
    }
    const salesByCategory = Object.values(categoryMap).sort((a, b) => b.revenue - a.revenue);

    // Expense by type
    const expenseMap: Record<string, { type: string; amount: number }> = {};
    for (const e of expenses) {
      if (!expenseMap[e.type]) {
        expenseMap[e.type] = { type: e.type, amount: 0 };
      }
      expenseMap[e.type].amount += e.amount;
    }
    const expenseByType = Object.values(expenseMap).sort((a, b) => b.amount - a.amount);

    // Top products
    const productSales: Record<number, { name: string; revenue: number; unitsSold: number }> = {};
    for (const t of transactions) {
      for (const item of t.items) {
        if (!productSales[item.productId]) {
          productSales[item.productId] = { name: item.product.name, revenue: 0, unitsSold: 0 };
        }
        productSales[item.productId].revenue += item.lineTotal;
        productSales[item.productId].unitsSold += item.quantity;
      }
    }
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return NextResponse.json({
      revenueOverTime,
      paymentMethods,
      salesByCategory,
      expenseByType,
      topProducts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load chart data.';
    console.error('[CHART-DATA] GET error:', error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
