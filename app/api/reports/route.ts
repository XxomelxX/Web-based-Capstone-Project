import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/reports?range=week|month|all
export async function GET(request: Request) {
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

  const transactions = await prisma.transaction.findMany({
    where: whereClause,
    include: { items: { include: { product: true } } },
  });

  const totalRevenue = transactions.reduce((sum, t) => sum + t.total, 0);
  const totalTransactions = transactions.length;
  const totalItemsSold = transactions.reduce(
    (sum, t) => sum + t.items.reduce((s, i) => s + i.quantity, 0),
    0
  );

  // Top selling products
  const productSales: Record<number, { name: string; unitsSold: number; revenue: number }> = {};
  for (const t of transactions) {
    for (const item of t.items) {
      if (!productSales[item.productId]) {
        productSales[item.productId] = { name: item.product.name, unitsSold: 0, revenue: 0 };
      }
      productSales[item.productId].unitsSold += item.quantity;
      productSales[item.productId].revenue += item.lineTotal;
    }
  }
  const topSelling = Object.values(productSales)
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 5);

  // Expenses in range
  const expenses = await prisma.expense.findMany({
    where: since ? { createdAt: { gte: since } } : {},
  });
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const products = await prisma.product.findMany({ where: { archived: false } });
  const settings = await prisma.settings.findFirst();
  const threshold = settings?.lowStockThreshold ?? 20;

  const stockLevels = products.map((p) => ({
    name: p.name,
    stock: p.stock,
    status: p.stock < threshold ? 'Critical' : 'OK',
  }));

  return NextResponse.json({
    range,
    totalRevenue,
    totalTransactions,
    totalItemsSold,
    totalExpenses,
    estimatedProfit: totalRevenue - totalExpenses,
    topSelling,
    stockLevels,
  });
}
