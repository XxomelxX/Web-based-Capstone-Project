'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCurrentUser } from '@/lib/client/hooks/useCurrentUser';
import { getReports, getTransactions, getLowStock, getUtangEntries } from '@/lib/client/api/inventory';
import { useRealtime } from '@/lib/client/hooks/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/client/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { PWAInstallBanner } from '@/components/PWAInstallBanner';
import { PageSkeleton } from '@/components/PageSkeleton';
import { WifiOff } from 'lucide-react';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import dynamic from 'next/dynamic';
import { peso } from '@/lib/money';

const RevenueChart = dynamic(() => import('@/components/charts/RevenueChart'), { ssr: false });
const PaymentMethodChart = dynamic(() => import('@/components/charts/PaymentMethodChart'), { ssr: false });
const CategorySalesChart = dynamic(() => import('@/components/charts/CategorySalesChart'), { ssr: false });
const ExpenseChart = dynamic(() => import('@/components/charts/ExpenseChart'), { ssr: false });
const TopProductsChart = dynamic(() => import('@/components/charts/TopProductsChart'), { ssr: false });

interface ReportData {
  totalRevenue: number;
  totalTransactions: number;
  totalItemsSold: number;
  // Optional: absent in pre-upgrade offline caches — treat as ₱0.
  totalOutstandingCredit?: number;
  topSelling: Array<{ name: string; unitsSold: number; revenue: number }>;
  stockLevels: Array<{ id?: number; name: string; stock: number; status: string }>;
}

interface ChartData {
  revenueOverTime: Array<{ date: string; revenue: number; transactions: number }>;
  paymentMethods: Array<{ method: string; count: number; total: number }>;
  salesByCategory: Array<{ category: string; revenue: number; items: number }>;
  expenseByType: Array<{ type: string; amount: number }>;
  topProducts: Array<{ name: string; revenue: number; unitsSold: number }>;
}

interface CashierTransactionItem {
  quantity: number;
  product: { name: string };
}

interface CashierTransaction {
  id: number;
  total: number;
  paymentMethod: string;
  createdAt: string;
  cashier: { fullName: string };
  items: CashierTransactionItem[];
}

interface LowStockProduct {
  id?: number;
  name?: string;
  stock?: number;
}

interface LowStockData {
  threshold: number;
  products: LowStockProduct[];
}

// Coerce any cached/server row into a render-safe transaction. Never throws.
function normalizeCashierTransaction(raw: unknown): CashierTransaction {
  const row = (raw ?? {}) as Record<string, unknown>;
  const cashier = (row.cashier ?? null) as { fullName?: unknown } | null;
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  const items = itemsRaw.map((rawItem) => {
    const item = (rawItem ?? {}) as Record<string, unknown>;
    const product = (item.product ?? null) as { name?: unknown } | null;
    return {
      quantity: Number(item.quantity) || 0,
      product: { name: typeof product?.name === 'string' ? product.name : 'Item' },
    };
  });
  return {
    id: Number(row.id) || 0,
    total: Number(row.total) || 0,
    paymentMethod: typeof row.paymentMethod === 'string' ? row.paymentMethod : 'cash',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date(0).toISOString(),
    cashier: { fullName: typeof cashier?.fullName === 'string' ? cashier.fullName : 'Cashier' },
    items,
  };
}

function timeValue(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function summarizeTransaction(transaction: CashierTransaction): string {
  const items = transaction.items ?? [];
  if (items.length === 0) return 'Sale';
  const first = items[0]?.product?.name || 'Item';
  return items.length > 1 ? `${first} ×${items.length}` : first;
}

function timeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function DashboardClient() {
  const { user } = useCurrentUser();
  // Least-privilege role fallback: a cached dashboard shell can render with no
  // resolvable identity (dead session on an offline device). Never leave the
  // user on an endless skeleton — after a short grace period treat "unknown"
  // as cashier, which fires zero admin-gated requests.
  const [roleFallback, setRoleFallback] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRoleFallback(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  // Wait for the session/identity to resolve before choosing a data source:
  // treating "unknown" as cashier would let an admin's first paint hit the
  // cashier path, and treating it as admin would fire the admin-gated reports
  // request for a cashier (the 403 this view is fixing).
  const roleReady = user !== null || roleFallback;
  const isAdmin = ((user?.role as string) ?? '').toLowerCase() === 'admin';
  const isCashier = roleReady && !isAdmin;

  const [range, setRange] = useState<'today' | 'week' | 'month' | 'year' | 'all'>('all');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [slowLoad, setSlowLoad] = useState(false);

  // Cashier-only view data — never sourced from admin-gated report endpoints.
  const [cashierTransactions, setCashierTransactions] = useState<CashierTransaction[] | null>(null);
  const [cashierLowStock, setCashierLowStock] = useState<LowStockData | null>(null);
  const [cashierOutstanding, setCashierOutstanding] = useState(0);
  const [cashierLoading, setCashierLoading] = useState(true);
  const [lowStockFailed, setLowStockFailed] = useState(false);

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, ms = 20000, label = 'Request'): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out. Please retry.`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const loadReports = useCallback(async (selectedRange: 'today' | 'week' | 'month' | 'year' | 'all') => {
    setError('');
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);

    // Instant paint: the synchronous localStorage snapshot always renders
    // first, so the page is visible before any network round trip.
    const cached = getCategory2Cache<ReportData>(`dashboard_${selectedRange}`);
    if (cached.data) {
      setData(cached.data);
      setIsCached(true);
      setLoading(false);
    } else {
      setLoading(true);
      setSlowLoad(false);
    }

    if (offlineNow) {
      if (!cached.data) {
        setError('You are offline and no cached data is available. Data will appear after you reconnect and the dashboard loads at least once.');
        setData(null);
        setLoading(false);
      }
      return;
    }

    const slowTimer = setTimeout(() => setSlowLoad(true), 8000);
    try {
      let stale = false;
      const reportData = await withTimeout(
        getReports<ReportData>(selectedRange, { onStale: () => { stale = true; } }),
        25000,
        'Dashboard report'
      );
      setData(reportData);
      saveCategory2Cache(`dashboard_${selectedRange}`, reportData);
      setIsCached(stale);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      if (!cached.data) {
        const fallback = getCategory2Cache<ReportData>(`dashboard_${selectedRange}`);
        if (fallback.data) {
          setData(fallback.data);
          setIsCached(true);
        } else {
          const msg = err instanceof Error ? err.message : 'Unable to load reports';
          setError(msg);
          setData(null);
        }
      }
      // With cached data already on screen, keep it — the banner marks it stale.
    } finally {
      clearTimeout(slowTimer);
      setSlowLoad(false);
      setLoading(false);
    }
  }, [withTimeout]);

  const loadChartData = useCallback(async (selectedRange: 'today' | 'week' | 'month' | 'year' | 'all') => {
    // Instant paint: show the last known charts before the network answers.
    const cached = getCategory2Cache<ChartData>(`chart_${selectedRange}`);
    if (cached.data) setChartData(cached.data);

    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    if (offlineNow) return;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const res = await fetch(`/api/reports/chart-data?range=${selectedRange}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setChartData(data);
          saveCategory2Cache(`chart_${selectedRange}`, data);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Cache (if any) is already on screen — nothing else to do.
    }
  }, []);

  // Cashier loader: only cashier-accessible endpoints (transactions + lowstock
  // + utang credit). Reports/chart-data are admin-only and are never requested
  // on this path.
  const loadCashier = useCallback(async () => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    setIsCached(offlineNow);
    setLowStockFailed(false);

    try {
      // Store-wide outstanding credit in integer centavos: sum every entry's
      // remainingBalance unless it is fully paid. Cache-backed rows may carry
      // stale shapes — coerce defensively, never let this throw.
      const entries = await getUtangEntries<{ remainingBalance?: unknown; status?: unknown }>();
      const outstanding = (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        return row.status === 'paid' ? sum : sum + (Number(row.remainingBalance) || 0);
      }, 0);
      setCashierOutstanding(outstanding);
    } catch {
      // Stat card — fail soft and keep the last known value.
    }

    try {
      // Reuses the Dexie-backed helper (fetch + mergeTransactions, cache fallback).
      const transactions = await getTransactions<CashierTransaction>();
      const normalized = (Array.isArray(transactions) ? transactions : [])
        .map(normalizeCashierTransaction)
        .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
      setCashierTransactions(normalized);
    } catch {
      setCashierTransactions((previous) => previous ?? []);
    }

    try {
      // Reuses the Dexie-backed helper (fetch + mergeProducts, cache fallback).
      const lowStock = (await getLowStock()) as unknown as LowStockData;
      setCashierLowStock({
        threshold: Number(lowStock?.threshold) || 20,
        products: Array.isArray(lowStock?.products) ? lowStock.products : [],
      });
    } catch {
      setLowStockFailed(true);
    } finally {
      setCashierLoading(false);
    }
  }, []);

  useRealtime({
    transactions: () => {
      if (!roleReady) return;
      if (isAdmin) {
        void loadReports(range);
        void loadChartData(range);
      } else {
        void loadCashier();
      }
    },
    expenses: () => {
      if (!roleReady || !isAdmin) return;
      void loadReports(range);
      void loadChartData(range);
    },
    restock: () => {
      if (!roleReady || !isAdmin) return;
      void loadReports(range);
    },
    products: () => {
      if (!roleReady) return;
      if (isAdmin) {
        void loadReports(range);
      } else {
        void loadCashier();
      }
    },
    utang: () => {
      if (!roleReady) return;
      if (isAdmin) {
        void loadReports(range);
      } else {
        void loadCashier();
      }
    },
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!roleReady) return;

    function handleReconnect() {
      if (isAdmin) {
        void loadReports(range);
        void loadChartData(range);
      } else {
        void loadCashier();
      }
    }

    if (isAdmin) {
      void loadReports(range);
      void loadChartData(range);
    } else {
      void loadCashier();
    }

    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    return () => window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
  }, [roleReady, isAdmin, range, loadReports, loadChartData, loadCashier]);

  const lowStockCount = data?.stockLevels.filter((s) => s.status === 'Critical').length ?? 0;

  const cashierTxns = cashierTransactions ?? [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayTotal = cashierTxns
    .filter((transaction) => timeValue(transaction.createdAt) >= startOfToday.getTime())
    .reduce((sum, transaction) => sum + transaction.total, 0);
  const latestTransactions = cashierTxns.slice(0, 10);
  const lowStockProducts = [...(cashierLowStock?.products ?? [])].sort(
    (a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0)
  );
  const cashierLowStockCount = lowStockProducts.length;

  return (
    <div className="space-y-6">
      <PWAInstallBanner />
      <CachedDataBanner
        isOffline={isOffline}
        isCached={isCached}
        onRefresh={isCashier ? () => loadCashier() : () => loadReports(range)}
      />
      {isOffline && (
        <div className="flex items-center gap-2 text-sm text-amber-200 bg-amber-950/60 border border-amber-800/40 rounded-xl px-4 py-2.5">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Offline — showing cached dashboard data. Sync on reconnect.</span>
        </div>
      )}

      <section className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6  backdrop-blur-xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Retail insights</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Welcome back, {user?.name || 'there'}</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              {isCashier
                ? 'Your shift at a glance — recent sales, low stock alerts, and outstanding customer credit. Full store reports are on the admin side.'
                : 'A professional summary of store performance, stock health, and sales trends for the selected reporting period.'}
            </p>
          </div>

          {isAdmin && (
            <div className="inline-flex items-center gap-3 rounded-3xl border border-[#e9e9e9] bg-[#e9e9e9] px-4 py-3 text-sm text-gray-900">
              <span className="text-gray-700">Report range</span>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as 'today' | 'week' | 'month' | 'year' | 'all')}
                className="rounded-2xl border border-[#d4d4d4] bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#a3a3a3]"
              >
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="year">This Year</option>
                <option value="all">All Time</option>
              </select>
            </div>
          )}
        </div>
      </section>

      {isCashier ? (
        cashierLoading ? (
          <PageSkeleton variant="dashboard" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <DashboardStatCard
                label="Sales Today"
                value={peso(todayTotal)}
                accent="text-emerald-300"
                hint="Today from latest sales"
              />
              <DashboardStatCard
                label="Low Stock Alerts"
                value={String(cashierLowStockCount)}
                accent={cashierLowStockCount > 0 ? 'text-rose-400' : 'text-slate-300'}
              />
              <DashboardStatCard
                label="Outstanding Credit"
                value={peso(cashierOutstanding)}
                accent={cashierOutstanding > 0 ? 'text-violet-300' : 'text-slate-300'}
                hint="Across all customer balances"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Latest Transactions</h2>
                    <p className="text-sm text-slate-500">Recent sales from your register.</p>
                  </div>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                    {latestTransactions.length} recent
                  </span>
                </div>

                {latestTransactions.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {isOffline ? 'Connect once and open the register — your log appears here.' : 'No sales yet today.'}
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                    {latestTransactions.map((transaction, idx) => (
                      <div
                        key={`${transaction.id}-${idx}`}
                        className="grid grid-cols-[1fr_auto] gap-4 rounded-3xl border border-slate-800/80 bg-slate-900/80 px-4 py-4 text-sm text-slate-200"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-100">{summarizeTransaction(transaction)}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {transaction.cashier.fullName} · {timeLabel(transaction.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <p className="font-semibold text-slate-200">{peso(transaction.total)}</p>
                          <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-300">
                            {transaction.paymentMethod.toLowerCase()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Low Stock</h2>
                    <p className="text-sm text-slate-500">Items below the alert threshold.</p>
                  </div>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                    {cashierLowStockCount} items
                  </span>
                </div>

                {lowStockFailed && !cashierLowStock ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-400">Low stock is unavailable right now.</p>
                    <button
                      type="button"
                      onClick={() => void loadCashier()}
                      className="inline-flex w-fit items-center rounded-3xl bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                ) : lowStockProducts.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {isOffline ? 'Connect once to check stock levels.' : 'No low stock items right now.'}
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                    {lowStockProducts.slice(0, 8).map((stock, idx) => (
                      <div
                        key={stock.id ?? `${stock.name}-${idx}`}
                        className="grid grid-cols-[1fr_auto_auto] gap-4 rounded-3xl border border-slate-800/80 bg-slate-900/80 px-4 py-4 text-sm text-slate-200"
                      >
                        <span className="font-medium text-slate-100">{stock.name || 'Item'}</span>
                        <span className="text-slate-400">{Number(stock.stock) || 0}</span>
                        <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300">
                          Critical
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )
      ) : loading ? (
        <div className="space-y-4">
          <PageSkeleton variant="dashboard" />
          {slowLoad && (
            <div className="flex flex-col gap-2 rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6">
              <p className="text-sm text-amber-300">This is taking longer than usual. You can wait or retry.</p>
              <button
                type="button"
                onClick={() => loadReports(range)}
                className="inline-flex w-fit items-center rounded-3xl bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 cursor-pointer"
              >
                Retry now
              </button>
            </div>
          )}
        </div>
      ) : error ? (
        <div className="rounded-[2rem] border border-rose-500/20 bg-rose-500/5 p-6 text-rose-100 ">
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={() => loadReports(range)}
            className="mt-4 inline-flex items-center rounded-3xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400 cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-8 ">
          <p className="text-slate-400">No report data available.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <DashboardStatCard label="Revenue" value={peso(data.totalRevenue)} accent="text-emerald-300" />
            <DashboardStatCard label="Transactions" value={String(data.totalTransactions)} accent="text-[#f59e0b]" />
            <DashboardStatCard label="Items Sold" value={String(data.totalItemsSold)} accent="text-emerald-400" />
            <DashboardStatCard label="Low Stock Alerts" value={String(lowStockCount)} accent={lowStockCount > 0 ? 'text-rose-400' : 'text-slate-300'} />
            <DashboardStatCard
              label="Outstanding Credit"
              value={peso(data.totalOutstandingCredit ?? 0)}
              accent={(data.totalOutstandingCredit ?? 0) > 0 ? 'text-violet-300' : 'text-slate-300'}
            />
          </div>

          {chartData && (
            <>
              <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Revenue Over Time</h2>
                    <p className="text-sm text-slate-500">Daily revenue trend for the selected period.</p>
                  </div>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">
                    Trend
                  </span>
                </div>
                <RevenueChart data={chartData.revenueOverTime} range={range} />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Payment Methods</h2>
                      <p className="text-sm text-slate-500">Cash vs GCash transaction split.</p>
                    </div>
                  </div>
                  <PaymentMethodChart data={chartData.paymentMethods} />
                </div>

                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Sales by Category</h2>
                      <p className="text-sm text-slate-500">Revenue contribution per product category.</p>
                    </div>
                  </div>
                  <CategorySalesChart data={chartData.salesByCategory} />
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Expense Breakdown</h2>
                      <p className="text-sm text-slate-500">Operating expenses by type.</p>
                    </div>
                  </div>
                  <ExpenseChart data={chartData.expenseByType} />
                </div>

                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Top Products</h2>
                      <p className="text-sm text-slate-500">Highest revenue products.</p>
                    </div>
                  </div>
                  <TopProductsChart data={chartData.topProducts} />
                </div>
              </div>
            </>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Best Selling Products</h2>
                  <p className="text-sm text-slate-500">Performance by units sold and revenue contribution.</p>
                </div>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-200">
                  Top 5
                </span>
              </div>

              {data.topSelling.length === 0 ? (
                <p className="text-sm text-slate-400">No sales data available yet.</p>
              ) : (
                <ol className="space-y-4">
                  {data.topSelling.map((product, index) => (
                    <li key={`${product.name}-${index}`} className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm text-slate-400">{index + 1}. {product.name}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.unitsSold} units sold</p>
                        </div>
                        <p className="text-sm font-semibold text-slate-200">{peso(product.revenue)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Stock Levels</h2>
                  <p className="text-sm text-slate-500">Monitor inventory health across categories.</p>
                </div>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                  {data.stockLevels.length} items
                </span>
              </div>

              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                {data.stockLevels.map((stock, idx) => (
                  <div key={stock.id ?? `${stock.name}-${idx}`} className="grid grid-cols-[1fr_auto_auto] gap-4 rounded-3xl border border-slate-800/80 bg-slate-900/80 px-4 py-4 text-sm text-slate-200">
                    <span className="font-medium text-slate-100">{stock.name}</span>
                    <span className="text-slate-400">{stock.stock}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stock.status === 'Critical' ? 'bg-rose-500/15 text-rose-300' : 'bg-white text-slate-700'}`}>
                      {stock.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardStatCard({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: string }) {
  return (
    <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-5 ">
      <p className="text-sm uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-4 text-3xl font-semibold ${accent ?? 'text-white'}`}>{value}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
