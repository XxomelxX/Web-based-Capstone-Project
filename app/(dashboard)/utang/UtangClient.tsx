'use client';

import { useEffect, useState } from 'react';
import { getUtangEntries, addUtang, recordUtangPayment } from '@/lib/api/inventory';
import { getProducts, Product } from '@/lib/api/products';
import { useRealtime } from '@/lib/use-realtime';

interface UtangItemLine { productId: number; quantity: number; unitPrice: number }
interface UtangEntry {
  id: number; customer: { name: string }; totalAmount: number; amountPaid: number;
  remainingBalance: number; status: string; note?: string; createdAt: string;
  items: Array<{ product: { name: string }; quantity: number; unitPrice: number; lineTotal: number }>;
}

export default function UtangClient() {
  const [entries, setEntries] = useState<UtangEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [error, setError] = useState('');

  const [customerName, setCustomerName] = useState('');
  const [lines, setLines] = useState<UtangItemLine[]>([{ productId: 0, quantity: 1, unitPrice: 0 }]);
  const [note, setNote] = useState('');

  const [payCustomer, setPayCustomer] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  function refresh() {
    getUtangEntries<UtangEntry>().then(setEntries);
    getProducts().then(setProducts);
  }

  useRealtime({
    utang: refresh,
    products: refresh,
  });

  useEffect(refresh, []);

  const customerMap = new Map<string, { balance: number; entries: UtangEntry[] }>();
  for (const e of entries) {
    const key = e.customer.name;
    const existing = customerMap.get(key) ?? { balance: 0, entries: [] };
    existing.balance += e.remainingBalance;
    existing.entries.push(e);
    customerMap.set(key, existing);
  }

  const customers = Array.from(customerMap.entries()).filter(([name]) =>
    name.toLowerCase().includes(search.toLowerCase())
  );
  const totalOutstanding = Array.from(customerMap.values()).reduce((s, c) => s + c.balance, 0);
  const customersWithUtang = Array.from(customerMap.values()).filter((c) => c.balance > 0).length;

  function updateLine(i: number, field: keyof UtangItemLine, value: number) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  async function handleAddUtang(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await addUtang({
        customerName,
        items: lines.filter((l) => l.productId > 0).map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
        note,
      });
      setShowAdd(false);
      setCustomerName('');
      setLines([{ productId: 0, quantity: 1, unitPrice: 0 }]);
      setNote('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add utang');
    }
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await recordUtangPayment({ customerName: payCustomer, amount: Number(payAmount), note: payNote });
      setShowPayment(false);
      setPayCustomer('');
      setPayAmount('');
      setPayNote('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Utang / Credit Tracking</h1>
          <p className="text-sm text-gray-500">Track customer credit balances and payments.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPayment(true)} className="border rounded-md px-4 py-2 text-sm">Record Payment</button>
          <button onClick={() => setShowAdd(true)} className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">+ Add Utang</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Total outstanding utang" value={`₱${totalOutstanding.toFixed(2)}`} accent="text-red-600" />
        <StatCard label="Customers with utang" value={customersWithUtang} />
        <StatCard label="Total entries" value={entries.length} />
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer name..." className="w-full border rounded-md px-4 py-2 bg-white" />

      <div className="bg-white rounded-xl shadow p-4 overflow-x-auto">
        <h2 className="font-semibold mb-2">Customer balances</h2>
        {customers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No customers yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="py-2">Customer</th><th>Balance</th><th>Status</th></tr></thead>
            <tbody>
              {customers.map(([name, c]) => (
                <tr key={name} className="border-t">
                  <td className="py-2">{name}</td>
                  <td>₱{c.balance.toFixed(2)}</td>
                  <td>{c.balance === 0 ? 'Paid' : c.balance < c.entries[0].totalAmount ? 'Partially Paid' : 'Unpaid'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-xl shadow p-4 overflow-x-auto">
        <h2 className="font-semibold mb-2">Recent activity</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No entries.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="py-2">Date</th><th>Customer</th><th>Items</th><th>Note</th><th>Amount</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-2">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td>{e.customer.name}</td>
                  <td>{e.items.map((i) => `${i.product.name} x${i.quantity}`).join(', ')}</td>
                  <td>{e.note}</td>
                  <td>₱{e.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAddUtang} className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between"><h3 className="font-bold text-lg">Add Utang</h3><button type="button" onClick={() => setShowAdd(false)}>×</button></div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Customer name</label>
              <input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Aling Nena" className="w-full border rounded-md px-3 py-2 mt-1 focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Items</label>
              {lines.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    value={line.productId}
                    onChange={(e) => {
                      const p = products.find((pr) => pr.id === Number(e.target.value));
                      updateLine(i, 'productId', Number(e.target.value));
                      if (p) updateLine(i, 'unitPrice', p.price);
                    }}
                    className="flex-1 border rounded-md px-2 py-2 text-sm"
                  >
                    <option value={0}>Select product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} (₱{p.price})</option>)}
                  </select>
                  <input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))} className="w-20 border rounded-md px-2 py-2 text-sm" />
                </div>
              ))}
              <button type="button" onClick={() => setLines([...lines, { productId: 0, quantity: 1, unitPrice: 0 }])} className="text-xs text-green-700">+ Add another item</button>
            </div>
            <p className="text-sm font-semibold">Total: ₱{lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0).toFixed(2)}</p>
            <div>
              <label className="text-sm font-medium">Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">Add Utang</button>
            </div>
          </form>
        </div>
      )}

      {showPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRecordPayment} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between"><h3 className="font-bold text-lg">Record Payment</h3><button type="button" onClick={() => setShowPayment(false)}>×</button></div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Customer name</label>
              <select required value={payCustomer} onChange={(e) => setPayCustomer(e.target.value)} className="w-full border rounded-md px-3 py-2 mt-1 focus:ring-2 focus:ring-green-500">
                <option value="">Select customer</option>
                {Array.from(customerMap.entries())
                  .filter(([, c]) => c.balance > 0)
                  .map(([name, c]) => (
                    <option key={name} value={name}>{name} — ₱{c.balance.toFixed(2)} outstanding</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Amount (₱)</label>
              <input required type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0.00" className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">Note (optional)</label>
              <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. partial payment" className="w-full border rounded-md px-3 py-2 mt-1" />
            </div>
            <p className="text-xs text-gray-400">Payment is applied to the customer's oldest unpaid entries first.</p>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowPayment(false)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">Record Payment</button>
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
