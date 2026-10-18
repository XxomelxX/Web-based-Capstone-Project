import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';

// GET /api/sync/pull?since=ISO — delta sync (blog §9 pullChanges).
// Returns products (delta), categories (full), customers (full), settings (single).
// Cashiers get the operational slice only: no transaction history, no payment
// allocations, no void-request cashier PII. Admins get the full mirror.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const role = (session.user as { role?: string }).role ?? 'cashier';
  const isAdmin = role === 'admin';
  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since');

  let sinceDate: Date | undefined;
  if (since) {
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: 'Invalid since parameter' }, { status: 400 });
    }
  }

  // Products: delta sync using updatedAt
  const productWhere = sinceDate ? { updatedAt: { gt: sinceDate } } : {};
  const products = await prisma.product.findMany({ where: productWhere, take: 500, include: { category: true } });

  // Categories, Customers, Settings: always pull all (small tables, no updatedAt)
  const [categories, customers, settings, utang, expenses, transactions, itemlog, voidRequests] = await Promise.all([
    prisma.category.findMany({ take: 200 }),
    prisma.customer.findMany({ take: 1000 }),
    prisma.settings.findFirst(),
    // Cashiers: balances without allocation/payment PII. Admins: full ledger.
    isAdmin
      ? prisma.utangEntry.findMany({ take: 1000, include: { customer: true, items: true, paymentAllocations: true } })
      : prisma.utangEntry.findMany({ take: 1000, include: { customer: true, items: true } }),
    isAdmin ? prisma.expense.findMany({ take: 500, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
    isAdmin ? prisma.transaction.findMany({ take: 500, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
    isAdmin ? prisma.itemLog.findMany({ take: 500, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
    prisma.voidRequest.findMany({
      where: { status: 'pending' },
      // Cashiers: no cashier PII on other users' requests.
      include: isAdmin ? { transaction: { include: { cashier: true } } } : { transaction: true },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    }),
  ]);

  return NextResponse.json({
    products,
    categories,
    customers,
    utang,
    expenses,
    transactions,
    itemlog,
    voidRequests,
    settings: settings ?? null,
    syncedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
