'use client';

import { useEffect, useState, useCallback } from 'react';
import { getExpenses, addExpense } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface Expense { id: number; type: string; amount: number; period: string; note?: string; createdAt: string }

type DateFilter = 'all' | 'week' | 'month' | 'year';

function getFilterStart(filter: DateFilter): Date | null {
  const now = new Date();
  if (filter === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (filter === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (filter === 'year') {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null;
}

export default function ExpensesClient() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ type: '', amount: '', period: '', note: '' });
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    getExpenses().then(setExpenses).catch(() => {});
  }, []);

  useRealtime({
    expenses: refresh,
  });

  useEffect(() => {
    refresh();
    function handleOnlineChange() {
      setIsOffline(typeof window !== 'undefined' && !navigator.onLine);
    }
    window.addEventListener('online', handleOnlineChange);
    window.addEventListener('offline', handleOnlineChange);
    return () => {
      window.removeEventListener('online', handleOnlineChange);
      window.removeEventListener('offline', handleOnlineChange);
    };
  }, [refresh]);

  function openAddModal() {
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return;
    }
    setError('');
    setShowModal(true);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return;
    }
    setError('');
    try {
      await addExpense({ type: form.type, amount: Number(form.amount), period: form.period, note: form.note });
      setShowModal(false);
      setForm({ type: '', amount: '', period: '', note: '' });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add expense');
    }
  }

  const filterStart = getFilterStart(dateFilter);
  const filtered = filterStart
    ? expenses.filter((e) => new Date(e.createdAt) >= filterStart)
    : expenses;

  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const totalThisMonth = expenses.filter((e) => e.period.startsWith(thisMonth) || e.createdAt.startsWith(thisMonth))
    .reduce((s, e) => s + e.amount, 0);
  const totalThisYear = expenses.filter((e) => e.createdAt.startsWith(new Date().getFullYear().toString()))
    .reduce((s, e) => s + e.amount, 0);

  const FILTERS: { key: DateFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
  ];

  return (
    <div className="space-y-4">
      {isOffline && (
        <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold">
          ⚠️ Adding expenses is disabled while offline. (Category 3 Low-value requirement)
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Expenses</h1>
          <p className="text-sm text-slate-400">Track your store&apos;s overhead and recurring costs</p>
        </div>
        <button
          onClick={openAddModal}
          disabled={isOffline}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold transition"
        >
          + Add Expense
        </button>
      </div>

      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="This Month" value={`₱${totalThisMonth.toFixed(2)}`} accent="text-cyan-400" />
        <StatCard label="This Year" value={`₱${totalThisYear.toFixed(2)}`} accent="text-emerald-400" />
        <StatCard label="Showing" value={`₱${totalFiltered.toFixed(2)}`} accent={dateFilter !== 'all' ? 'text-amber-400' : 'text-slate-200'} />
      </div>

      <div className="flex gap-1 bg-slate-900 rounded-lg p-1 w-fit border border-slate-800">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setDateFilter(f.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${dateFilter === f.key ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[500px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Period</th><th className="p-3">Notes</th><th className="p-3">Date Added</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">No expenses for this period.</td></tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} className="hover:bg-slate-900/50">
                  <td className="p-3 font-medium text-slate-100">{e.type}</td>
                  <td className="p-3 font-semibold text-rose-400">₱{e.amount.toFixed(2)}</td>
                  <td className="p-3 text-slate-400">{e.period}</td>
                  <td className="p-3 text-slate-400">{e.note || '—'}</td>
                  <td className="p-3 text-slate-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Add Expense</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            {isOffline && (
              <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                This action requires an internet connection.
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div>
              <label className="text-sm font-medium text-slate-300">Expense Type</label>
              <input required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="e.g. Electricity" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Amount (₱)</label>
              <input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Period</label>
              <input required value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="e.g. July 2026" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Notes</label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={isOffline} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold">Add Expense</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}
