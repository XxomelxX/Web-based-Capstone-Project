'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { getReports } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface ReportData {
  totalRevenue: number;
  totalTransactions: number;
  totalItemsSold: number;
  topSelling: Array<{ name: string; unitsSold: number; revenue: number }>;
  stockLevels: Array<{ name: string; stock: number; status: string }>;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [range, setRange] = useState<'week' | 'month' | 'all'>('all');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadReports(selectedRange: 'week' | 'month' | 'all') {
    setLoading(true);
    setError('');
    try {
      const reportData = await getReports<ReportData>(selectedRange);
      setData(reportData);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      setError(err instanceof Error ? err.message : 'Unable to load reports');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useRealtime({
    transactions: () => void loadReports(range),
    expenses: () => void loadReports(range),
    restock: () => void loadReports(range),
    products: () => void loadReports(range),
    utang: () => void loadReports(range),
  });

  useEffect(() => {
    const fetchReports = async () => {
      await loadReports(range);
    };
    void fetchReports();
  }, [range]);

  const lowStockCount = data?.stockLevels.filter((s) => s.status === 'Critical').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome back, {session?.user?.name ?? '...'}</h1>
          <p className="text-gray-500 text-sm">Here&apos;s what&apos;s happening in your store today</p>
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as 'week' | 'month' | 'all')}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="all">All Time</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : error ? (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => loadReports(range)}
            className="inline-flex items-center rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <p className="text-gray-500">No report data available.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <StatCard label="Revenue" value={`₱${data.totalRevenue.toFixed(2)}`} />
            <StatCard label="Transactions" value={String(data.totalTransactions)} />
            <StatCard label="Items Sold" value={String(data.totalItemsSold)} />
            <StatCard label="Low Stock Alerts" value={String(lowStockCount)} accent="text-red-600" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="font-semibold mb-3">Top Selling Products</h2>
              {data.topSelling.length === 0 ? (
                <p className="text-sm text-gray-400">No sales yet.</p>
              ) : (
                <ol className="space-y-2">
                  {data.topSelling.map((p, i) => (
                    <li key={p.name} className="flex justify-between text-sm">
                      <span>{i + 1}. {p.name} — {p.unitsSold} sold</span>
                      <span className="font-medium">₱{p.revenue.toFixed(2)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="font-semibold mb-3">Stock Levels</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.stockLevels.map((s) => (
                  <div key={s.name} className="flex justify-between text-sm">
                    <span>{s.name}</span>
                    <span>{s.stock}</span>
                    <span className={s.status === 'Critical' ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                      {s.status}
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

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
