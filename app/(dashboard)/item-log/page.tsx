'use client';

import { useEffect, useState } from 'react';
import { getItemLog } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface ItemLogEntry {
  id: number; createdAt: string; action: string; quantity: number;
  product: { name: string }; user: { fullName: string };
}

const ACTION_COLORS: Record<string, string> = {
  sold: 'bg-blue-100 text-blue-700',
  restocked: 'bg-green-100 text-green-700',
  voided: 'bg-red-100 text-red-700',
  adjusted: 'bg-yellow-100 text-yellow-800',
};

function getPresetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);

  if (preset === 'today') {
    return { from: to, to };
  }
  if (preset === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    return { from: d.toISOString().slice(0, 10), to };
  }
  if (preset === 'month') {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to };
  }
  return { from: '', to: '' };
}

export default function ItemLogPage() {
  const [logs, setLogs] = useState<ItemLogEntry[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function refresh() {
    getItemLog<ItemLogEntry>().then(setLogs);
  }

  useRealtime({
    itemlog: refresh,
    transactions: refresh,
    restock: refresh,
  });

  useEffect(() => {
    refresh();
  }, []);

  function applyPreset(preset: string) {
    const range = getPresetRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  // Filter by date range
  const filtered = logs.filter((l) => {
    if (!dateFrom && !dateTo) return true;
    const d = l.createdAt.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  // Sort: non-voided first, voided last; createdAt desc within each group
  const sorted = [...filtered].sort((a, b) => {
    if (a.action === 'voided' && b.action !== 'voided') return 1;
    if (a.action !== 'voided' && b.action === 'voided') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Item Log</h1>
        <p className="text-sm text-gray-500">Every stock movement — sales, restocks, and voids — logged automatically.</p>
      </div>

      {/* Date filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-md px-2 py-1 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-md px-2 py-1 text-sm" />
        </div>
        <div className="flex gap-1">
          <button onClick={() => applyPreset('today')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50">Today</button>
          <button onClick={() => applyPreset('week')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50">This Week</button>
          <button onClick={() => applyPreset('month')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50">This Month</button>
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50 text-gray-400">Clear</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="p-3">Date</th><th className="p-3">Product</th><th className="p-3">Action</th><th className="p-3">Quantity</th><th className="p-3">Performed By</th></tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-3">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="p-3">{l.product?.name}</td>
                <td className="p-3"><span className={`text-xs px-2 py-1 rounded-full capitalize ${ACTION_COLORS[l.action] ?? 'bg-gray-100'}`}>{l.action}</span></td>
                <td className="p-3">{l.quantity}</td>
                <td className="p-3">{l.user?.fullName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
