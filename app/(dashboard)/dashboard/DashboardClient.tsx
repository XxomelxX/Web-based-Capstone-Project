'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { getReports } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { RECONNECT_EVENT_NAME } from '@/lib/useOfflineSync';
import dynamic from 'next/dynamic';

const RevenueChart = dynamic(() => import('@/components/charts/RevenueChart'), { ssr: false });
const PaymentMethodChart = dynamic(() => import('@/components/charts/PaymentMethodChart'), { ssr: false });
const CategorySalesChart = dynamic(() => import('@/components/charts/CategorySalesChart'), { ssr: false });
const ExpenseChart = dynamic(() => import('@/components/charts/ExpenseChart'), { ssr: false });
const TopProductsChart = dynamic(() => import('@/components/charts/TopProductsChart'), { ssr: false });

interface ReportData {
  totalRevenue: number;
  totalTransactions: number;
  totalItemsSold: number;
  topSelling: Array<{ name: string; unitsSold: number; revenue: number }>;
  stockLevels: Array<{ name: string; stock: number; status: string }>;
}

interface ChartData {
  revenueOverTime: Array<{ date: string; revenue: number; transactions: number }>;
  paymentMethods: Array<{ method: string; count: number; total: number }>;
  salesByCategory: Array<{ category: string; revenue: number; items: number }>;
  expenseByType: Array<{ type: string; amount: number }>;
  topProducts: Array<{ name: string; revenue: number; unitsSold: number }>;
}

export default function DashboardClient() {
  const { user } = useCurrentUser();
  const [range, setRange] = useState<'week' | 'month' | 'all'>('all');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [cachedTime, setCachedTime] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [chartData, setChartData] = useState<ChartData | null>(null);

  const loadReports = useCallback(async (selectedRange: 'week' | 'month' | 'all') => {
    setLoading(true);
    setError('');
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);

    try {
      if (offlineNow) {
        const cached = getCategory2Cache<ReportData>(`dashboard_${selectedRange}`);
        if (cached.data) {
          setData(cached.data);
          setIsCached(true);
          setCachedTime(cached.formattedTime || cached.cachedAt);
        } else {
          throw new Error('Offline and no cached snapshot available');
        }
      } else {
        const reportData = await getReports<ReportData>(selectedRange);
        setData(reportData);
        saveCategory2Cache(`dashboard_${selectedRange}`, reportData);
        setIsCached(false);
        setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
      }
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      // Fallback to cache if network error
      const cached = getCategory2Cache<ReportData>(`dashboard_${selectedRange}`);
      if (cached.data) {
        setData(cached.data);
        setIsCached(true);
        setCachedTime(cached.formattedTime || cached.cachedAt);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load reports');
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChartData = useCallback(async (selectedRange: 'week' | 'month' | 'all') => {
    if (typeof window !== 'undefined' && !navigator.onLine) return;
    try {
      const res = await fetch(`/api/reports/chart-data?range=${selectedRange}`);
      if (res.ok) {
        const data = await res.json();
        setChartData(data);
      }
    } catch {
      // Silently fail — charts are non-critical
    }
  }, []);

  useRealtime({
    transactions: () => { void loadReports(range); void loadChartData(range); },
    expenses: () => { void loadReports(range); void loadChartData(range); },
    restock: () => void loadReports(range),
    products: () => void loadReports(range),
    utang: () => void loadReports(range),
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadReports(range);
    void loadChartData(range);

    function handleReconnect() {
      void loadReports(range);
      void loadChartData(range);
    }

    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    return () => window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
  }, [range, loadReports, loadChartData]);

  const lowStockCount = data?.stockLevels.filter((s) => s.status === 'Critical').length ?? 0;

  return (
    <div className="space-y-6">
      <CachedDataBanner
        cachedAt={cachedTime}
        formattedTime={cachedTime}
        isOffline={isOffline}
        isCached={isCached}
        onRefresh={() => loadReports(range)}
      />

      <section className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Retail insights</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Welcome back, {user?.name ?? 'Store Manager'}</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              A professional summary of store performance, stock health, and sales trends for the selected reporting period.
            </p>
          </div>

          <div className="inline-flex items-center gap-3 rounded-3xl border border-[#f59e0b] bg-[#f59e0b] px-4 py-3 text-sm text-gray-900 shadow-lg shadow-black/10">
            <span className="text-gray-700">Report range</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as 'week' | 'month' | 'all')}
              className="rounded-2xl border border-[#d97706] bg-[#f59e0b] px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#d97706]"
            >
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-8 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
          <p className="text-slate-400">Loading dashboard analytics…</p>
        </div>
      ) : error ? (
        <div className="rounded-[2rem] border border-rose-500/20 bg-rose-500/5 p-6 text-rose-100 shadow-[0_24px_80px_-46px_rgba(139,0,0,0.45)]">
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
        <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-8 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
          <p className="text-slate-400">No report data available.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardStatCard label="Revenue" value={`₱${data.totalRevenue.toFixed(2)}`} accent="text-emerald-300" />
            <DashboardStatCard label="Transactions" value={String(data.totalTransactions)} accent="text-[#f59e0b]" />
            <DashboardStatCard label="Items Sold" value={String(data.totalItemsSold)} accent="text-emerald-400" />
            <DashboardStatCard label="Low Stock Alerts" value={String(lowStockCount)} accent={lowStockCount > 0 ? 'text-rose-400' : 'text-slate-300'} />
          </div>

          {chartData && (
            <>
              <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
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
                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Payment Methods</h2>
                      <p className="text-sm text-slate-500">Cash vs GCash transaction split.</p>
                    </div>
                  </div>
                  <PaymentMethodChart data={chartData.paymentMethods} />
                </div>

                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
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
                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">Expense Breakdown</h2>
                      <p className="text-sm text-slate-500">Operating expenses by type.</p>
                    </div>
                  </div>
                  <ExpenseChart data={chartData.expenseByType} />
                </div>

                <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
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
            <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Top Selling Products</h2>
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
                    <li key={product.name} className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm text-slate-400">{index + 1}. {product.name}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.unitsSold} units sold</p>
                        </div>
                        <p className="text-sm font-semibold text-slate-200">₱{product.revenue.toFixed(2)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
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
                {data.stockLevels.map((stock) => (
                  <div key={stock.name} className="grid grid-cols-[1fr_auto_auto] gap-4 rounded-3xl border border-slate-800/80 bg-slate-900/80 px-4 py-4 text-sm text-slate-200">
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

function DashboardStatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-5 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
      <p className="text-sm uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-4 text-3xl font-semibold ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}
