'use client';

import { useEffect, useState } from 'react';
import { getReports } from '@/lib/api/inventory';

interface ReportData {
  totalRevenue: number; totalTransactions: number; totalItemsSold: number;
  totalExpenses: number; estimatedProfit: number;
  topSelling: Array<{ name: string; unitsSold: number; revenue: number }>;
  stockLevels: Array<{ name: string; stock: number; status: string }>;
}

export default function ReportsPage() {
  const [range, setRange] = useState<'week' | 'month' | 'all'>('all');
  const [data, setData] = useState<ReportData | null>(null);

  useEffect(() => {
    getReports(range).then(setData);
  }, [range]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-gray-500">Sales performance and inventory insights</p>
        </div>
        <select value={range} onChange={(e) => setRange(e.target.value as 'week' | 'month' | 'all')} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="all">All Time</option>
        </select>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Revenue" value={`₱${data.totalRevenue.toFixed(2)}`} />
            <StatCard label="Transactions" value={data.totalTransactions} />
            <StatCard label="Items Sold" value={data.totalItemsSold} />
            <StatCard label="Est. Profit" value={`₱${data.estimatedProfit.toFixed(2)}`} accent="text-green-700" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="font-semibold mb-3">Top Selling Products</h2>
              {data.topSelling.length === 0 ? <p className="text-sm text-gray-400">No sales yet.</p> : (
                <ol className="space-y-2 text-sm">
                  {data.topSelling.map((p, i) => (
                    <li key={p.name} className="flex justify-between">
                      <span>{i + 1}. {p.name} — {p.unitsSold} sold</span>
                      <span className="font-medium">₱{p.revenue.toFixed(2)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="bg-white rounded-xl shadow p-5">
              <h2 className="font-semibold mb-3">Stock Levels</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto text-sm">
                {data.stockLevels.map((s) => (
                  <div key={s.name} className="flex justify-between">
                    <span>{s.name}</span><span>{s.stock}</span>
                    <span className={s.status === 'Critical' ? 'text-red-600 font-semibold' : 'text-gray-500'}>{s.status}</span>
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

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return <div className="bg-white rounded-xl shadow p-4"><p className="text-xs text-gray-500">{label}</p><p className={`text-xl font-bold ${accent ?? ''}`}>{value}</p></div>;
}
