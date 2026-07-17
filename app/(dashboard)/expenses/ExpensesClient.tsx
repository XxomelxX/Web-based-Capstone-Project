'use client';

import { useEffect, useState } from 'react';
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

  function refresh() {
    getExpenses().then(setExpenses);
  }

  useRealtime({
    expenses: refresh,
  });

  useEffect(refresh, []);

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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
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

  const FILTERS: { key: DateFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-gray-500">Track your store's overhead and recurring costs</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">+ Add Expense</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="This Month" value={`₱${totalThisMonth.toFixed(2)}`} />
        <StatCard label="This Year" value={`₱${totalThisYear.toFixed(2)}`} />
        <StatCard label="Showing" value={`₱${totalFiltered.toFixed(2)}`} accent={dateFilter !== 'all' ? 'text-blue-600' : undefined} />
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setDateFilter(f.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${dateFilter === f.key ? 'bg-white shadow text-green-700' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Period</th><th className="p-3">Notes</th><th className="p-3">Date Added</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-gray-400">No expenses for this period.</td></tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-3">{e.type}</td>
                  <td className="p-3">₱{e.amount.toFixed(2)}</td>
                  <td className="p-3">{e.period}</td>
                  <td className="p-3 text-gray-500">{e.note}</td>
                  <td className="p-3">{new Date(e.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdd} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between"><h3 className="font-bold text-lg">Add Expense</h3><button type="button" onClick={() => setShowModal(false)}>×</button></div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Expense Type</label>
              <input required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="e.g. Electricity" className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Amount (₱)</label>
              <input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Period</label>
              <input required value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="e.g. July 2026" className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">Add Expense</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return <div className="bg-white rounded-xl shadow p-4"><p className="text-xs text-gray-500">{label}</p><p className={`text-xl font-bold ${accent ?? ''}`}>{value}</p></div>;
}
