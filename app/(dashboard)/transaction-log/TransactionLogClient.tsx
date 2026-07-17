'use client';

import { useEffect, useState } from 'react';
import { getTransactions } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface Transaction {
  id: number; createdAt: string; cashier: { fullName: string };
  paymentMethod: string; total: number; status: string;
}

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

export default function TransactionLogClient() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function refresh() {
    getTransactions<Transaction>().then(setTransactions);
  }

  useRealtime({
    transactions: refresh,
  });

  useEffect(() => {
    refresh();
  }, []);

  function applyPreset(preset: string) {
    const range = getPresetRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  const filtered = transactions.filter((t) => {
    if (!dateFrom && !dateTo) return true;
    const d = t.createdAt.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.status === 'voided' && b.status !== 'voided') return 1;
    if (a.status !== 'voided' && b.status === 'voided') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Transaction Log</h1>
        <p className="text-sm text-gray-500">Full chronological audit of every sale — read-only.</p>
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
          <button onClick={() => applyPreset('today')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50">Today</button>
          <button onClick={() => applyPreset('week')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50">This Week</button>
          <button onClick={() => applyPreset('month')} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50">This Month</button>
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs px-3 py-1 rounded-full border hover:bg-gray-50 text-gray-400">Clear</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="p-3">Order#</th><th className="p-3">Date/Time</th><th className="p-3">Cashier</th><th className="p-3">Payment</th><th className="p-3">Total</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-3">#{t.id}</td>
                <td className="p-3">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="p-3">{t.cashier?.fullName}</td>
                <td className="p-3 capitalize">{t.paymentMethod}</td>
                <td className="p-3">₱{t.total.toFixed(2)}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${t.status === 'voided' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'}`}>{t.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
