'use client';

import { useEffect, useState } from 'react';
import { getItemLog } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { exportToExcel } from '@/lib/exportExcel';
import { Download } from 'lucide-react';

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

export default function ItemLogClient() {
  const [logs, setLogs] = useState<ItemLogEntry[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function refresh() {
    getItemLog<ItemLogEntry>().then(setLogs).catch(() => {});
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

  const filtered = logs.filter((l) => {
    if (!dateFrom && !dateTo) return true;
    const d = l.createdAt.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.action === 'voided' && b.action !== 'voided') return 1;
    if (a.action !== 'voided' && b.action === 'voided') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  function handleExport() {
    exportToExcel('Item Log', [{
      name: 'Item Log',
      columns: [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Product', key: 'product', width: 28 },
        { header: 'Action', key: 'action', width: 14 },
        { header: 'Quantity', key: 'quantity', width: 10 },
        { header: 'Performed By', key: 'user', width: 20 },
      ],
      data: sorted.map((l) => ({
        date: new Date(l.createdAt).toLocaleString(),
        product: l.product?.name || '',
        action: l.action,
        quantity: l.quantity,
        user: l.user?.fullName || '',
      })),
    }]);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Item Log</h1>
        <p className="text-sm text-gray-500">Every stock movement — sales, restocks, and voids — logged automatically.</p>
      </div>

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
          <button onClick={() => applyPreset('today')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50 cursor-pointer">Today</button>
          <button onClick={() => applyPreset('week')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50 cursor-pointer">This Week</button>
          <button onClick={() => applyPreset('month')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50 cursor-pointer">This Month</button>
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50 text-gray-400 cursor-pointer">Clear</button>
        </div>
        <button onClick={handleExport} className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-emerald-600 text-emerald-700 hover:bg-emerald-50 cursor-pointer ml-auto">
          <Download size={14} /> Export Excel
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[600px] w-full text-sm">
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
