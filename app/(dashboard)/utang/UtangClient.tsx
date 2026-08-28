'use client';

import { useEffect, useState, useCallback } from 'react';
import { getUtangEntries, addUtang, recordUtangPayment } from '@/lib/api/inventory';
import { getProducts, Product } from '@/lib/api/products';
import { useRealtime } from '@/lib/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { RECONNECT_EVENT_NAME } from '@/lib/useOfflineSync';

interface UtangItemLine { productId: number; quantity: number; unitPrice: number }
interface UtangEntry {
  id: number; customer: { name: string }; totalAmount: number; amountPaid: number;
  remainingBalance: number; status: string; note?: string; createdAt: string;
  items: Array<{ product: { name: string }; quantity: number; unitPrice: number; lineTotal: number }>;
  offline?: boolean;
}

export default function UtangClient() {
  const [entries, setEntries] = useState<UtangEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [cachedTime, setCachedTime] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [lines, setLines] = useState<UtangItemLine[]>([{ productId: 0, quantity: 1, unitPrice: 0 }]);
  const [note, setNote] = useState('');

  const [payCustomer, setPayCustomer] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);

    if (offlineNow) {
      const cached = getCategory2Cache<UtangEntry[]>('utang');
      if (cached.data) {
        setEntries(cached.data);
        setIsCached(true);
        setCachedTime(cached.formattedTime || cached.cachedAt);
      }
      const cachedProds = getCategory2Cache<Product[]>('products_active');
      if (cachedProds.data) setProducts(cachedProds.data);
    } else {
      getUtangEntries<UtangEntry>()
        .then((data) => {
          setEntries(data);
          saveCategory2Cache('utang', data);
          setIsCached(false);
          setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
        })
        .catch(() => {
          const cached = getCategory2Cache<UtangEntry[]>('utang');
          if (cached.data) {
            setEntries(cached.data);
            setIsCached(true);
            setCachedTime(cached.formattedTime || cached.cachedAt);
          }
        });

      getProducts().then(setProducts).catch(() => {});
    }
  }, []);

  useRealtime({
    utang: refresh,
    products: refresh,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();

    function handleReconnect() {
      refresh();
    }

    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    return () => window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
  }, [refresh]);

  const customerMap = new Map<string, { balance: number; entries: UtangEntry[] }>();
  for (const e of entries) {
    const key = e.customer?.name || 'Unknown';
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
    setNotice('');
    try {
      const res = await addUtang({
        customerName,
        items: lines.filter((l) => l.productId > 0).map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
        note,
      });
      if (res?.offline) {
        setNotice('Utang entry queued offline! It will automatically sync once online.');
      }
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
    setNotice('');
    const targetCustomer = customerMap.get(payCustomer.trim());
    const expectedBalance = targetCustomer ? targetCustomer.balance - Number(payAmount) : undefined;

    try {
      const res = await recordUtangPayment({
        customerName: payCustomer,
        amount: Number(payAmount),
        note: payNote,
        expectedBalance,
      });
      if (res?.offline) {
        setNotice('Utang payment queued offline! It will auto-post on reconnect (flagged for manual review if balance changes).');
      }
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
      <CachedDataBanner
        cachedAt={cachedTime}
        formattedTime={cachedTime}
        isOffline={isOffline}
        isCached={isCached}
        onRefresh={refresh}
      />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Utang / Credit Tracking</h1>
          <p className="text-sm text-slate-400">Track customer credit balances and payments (Category 1 offline queue enabled).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPayment(true)} className="border border-slate-700 hover:bg-slate-800 text-slate-200 rounded-xl px-4 py-2 text-sm font-semibold transition">
            Record Payment
          </button>
          <button onClick={() => setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2 text-sm font-semibold transition">
            + Add Utang
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Total outstanding utang" value={`₱${totalOutstanding.toFixed(2)}`} accent="text-rose-400" />
        <StatCard label="Customers with utang" value={customersWithUtang} accent="text-amber-400" />
        <StatCard label="Total entries" value={entries.length} accent="text-cyan-400" />
      </div>

      {notice && <p className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-md px-3 py-2">{notice}</p>}
      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search customer name..."
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-cyan-500"
      />

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow p-4 overflow-x-auto">
        <h2 className="font-semibold text-white mb-2">Customer balances</h2>
        {customers.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No customers yet.</p>
        ) : (
          <table className="min-w-[500px] w-full text-sm">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-2">Customer</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {customers.map(([name, c]) => (
                <tr key={name} className="hover:bg-slate-900/50">
                  <td className="py-2.5 font-medium text-slate-100">{name}</td>
                  <td className="font-semibold text-rose-400">₱{c.balance.toFixed(2)}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.balance === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      {c.balance === 0 ? 'Paid' : 'Unpaid Utang'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow p-4 overflow-x-auto">
        <h2 className="font-semibold text-white mb-2">Recent activity</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No entries.</p>
        ) : (
          <table className="min-w-[500px] w-full text-sm">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-2">Date</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Note</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-900/50">
                  <td className="py-2.5 text-slate-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="font-medium text-slate-100">{e.customer?.name || 'Unknown'}</td>
                  <td className="text-slate-300">{e.items?.map((i) => `${i.product?.name || 'Item'} x${i.quantity}`).join(', ') || '—'}</td>
                  <td className="text-slate-400">{e.note || '—'}</td>
                  <td className="font-semibold text-emerald-400">₱{e.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Utang Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAddUtang} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Add Utang {isOffline && '(Offline Queue Mode)'}</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            {isOffline && (
              <p className="text-xs text-amber-300 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                ⚡ You are offline. Utang will be saved locally in Category 1 queue &amp; synced on reconnect.
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div>
              <label className="text-sm font-medium text-slate-300">Customer name</label>
              <input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Aling Nena" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Items</label>
              {lines.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    value={line.productId}
                    onChange={(e) => {
                      const p = products.find((pr) => pr.id === Number(e.target.value));
                      updateLine(i, 'productId', Number(e.target.value));
                      if (p) updateLine(i, 'unitPrice', p.price);
                    }}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-2 py-2 text-sm text-white outline-none"
                  >
                    <option value={0}>Select product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} (₱{p.price})</option>)}
                  </select>
                  <input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))} className="w-20 bg-slate-950 border border-slate-700 rounded-xl px-2 py-2 text-sm text-white outline-none" />
                </div>
              ))}
              <button type="button" onClick={() => setLines([...lines, { productId: 0, quantity: 1, unitPrice: 0 }])} className="text-xs text-cyan-400 font-semibold hover:underline">+ Add another item</button>
            </div>
            <p className="text-sm font-semibold text-emerald-400">Total: ₱{lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0).toFixed(2)}</p>
            <div>
              <label className="text-sm font-medium text-slate-300">Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2 text-sm font-semibold">Add Utang</button>
            </div>
          </form>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRecordPayment} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Record Utang Payment</h3>
              <button type="button" onClick={() => setShowPayment(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            {isOffline && (
              <p className="text-xs text-amber-300 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                ⚡ Offline mode active. Payment queued in Category 1 and will auto-apply FIFO on reconnect (flagged for review if balance changes).
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div>
              <label className="text-sm font-medium text-slate-300">Customer Name</label>
              <input
                required
                value={payCustomer}
                onChange={(e) => setPayCustomer(e.target.value)}
                placeholder="e.g. Aling Nena"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Payment Amount (₱)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Note (optional)</label>
              <input
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="e.g. Partial cash payment"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowPayment(false)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" className="bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl px-4 py-2 text-sm font-semibold">Record Payment</button>
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
