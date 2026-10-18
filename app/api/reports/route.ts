import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireSession } from '@/lib/server/require-session';
import { isDbUnreachable, DB_UNAVAILABLE_MESSAGE } from '@/lib/server/db-unreachable';

// GET /api/reports?range=week|month|all
export async function GET(request: Request) {
  const guard = await requireSession();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') ?? 'all';

  const now = new Date();
  let since: Date | undefined;
  if (range === 'today') {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (range === 'week') {
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === 'month') {
    since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (range === 'year') {
    since = new Date(now.getFullYear(), 0, 1);
  }

  const whereClause = {
    status: 'complete' as const,
    ...(since ? { createdAt: { gte: since } } : {}),
  };

  try {
    const [transactionTotals, itemTotals, productSales, expenseTotals, products, settings, outstanding] =
      await Promise.all([
        prisma.transaction.aggregate({
          where: whereClause,
          _count: { _all: true },
          _sum: { total: true },
        }),
        prisma.transactionItem.aggregate({
          where: { transaction: { is: whereClause } },
          _sum: { quantity: true },
        }),
        prisma.transactionItem.groupBy({
          by: ['productId'],
          where: { transaction: { is: whereClause } },
          _sum: { quantity: true, lineTotal: true },
        }),
        prisma.expense.aggregate({
          where: since ? { createdAt: { gte: since } } : {},
          _sum: { amount: true },
        }),
        prisma.product.findMany({
          select: { id: true, name: true, stock: true, archived: true },
        }),
        prisma.settings.findFirst(),
        prisma.utangEntry.aggregate({
          where: { status: { not: 'paid' } },
          _sum: { remainingBalance: true },
        }),
      ]);

    const totalRevenue = transactionTotals._sum.total ?? 0;
    const totalTransactions = transactionTotals._count._all;
    const totalItemsSold = itemTotals._sum.quantity ?? 0;
    const totalExpenses = expenseTotals._sum.amount ?? 0;
    const totalOutstandingCredit = outstanding._sum.remainingBalance ?? 0;
    const threshold = settings?.lowStockThreshold ?? 20;
    const productNames = new Map(products.map((product) => [product.id, product.name]));

    const topSelling = productSales
      .map((sale) => {
        const name = productNames.get(sale.productId);
        if (name === undefined) {
          throw new Error(`Product ${sale.productId} was not found for a report item.`);
        }
        return {
          name,
          unitsSold: sale._sum.quantity ?? 0,
          revenue: sale._sum.lineTotal ?? 0,
        };
      })
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 5);

    const stockLevels = products
      .filter((product) => !product.archived)
      .map((product) => ({
        id: product.id,
        name: product.name,
        stock: product.stock,
        status: product.stock < threshold ? 'Critical' : 'OK',
      }));

    return NextResponse.json({
      range,
      totalRevenue,
      totalTransactions,
      totalItemsSold,
      totalExpenses,
      estimatedProfit: totalRevenue - totalExpenses,
      totalOutstandingCredit,
      topSelling,
      stockLevels,
    });
  } catch (error) {
    console.error('[REPORTS] GET error:', error);
    if (isDbUnreachable(error)) {
      return NextResponse.json(
        { error: DB_UNAVAILABLE_MESSAGE },
        { status: 503, headers: { 'Retry-After': '5' } }
      );
    }
    const message = error instanceof Error ? error.message : 'Unable to load reports.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
