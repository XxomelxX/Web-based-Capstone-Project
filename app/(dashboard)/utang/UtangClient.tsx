'use client';

import { useEffect, useState, useCallback } from 'react';
import { getUtangEntries, addUtang, recordUtangPayment, getCustomersLight, addCustomer, refetchUtangEntries, deleteCustomer } from '@/lib/api/inventory';
import { getProducts, Product } from '@/lib/api/products';
import { useRealtime } from '@/lib/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { RECONNECT_EVENT_NAME } from '@/lib/useOfflineSync';

interface UtangItemLine { productId: number; quantity: number; unitPrice: number }
interface UtangEntry {
  id: number; customer: { name: string; id?: number }; totalAmount: number; amountPaid: number;
  remainingBalance: number; status: string; note?: string; createdAt: string;
  items: Array<{ product: { name: string }; quantity: number; unitPrice: number; lineTotal: number }>;
  paymentAllocations?: Array<{ payment: { createdAt: string } }>;
  offline?: boolean;
}
interface CustomerLight { id: number; name: string }

export default function UtangClient() {
  const [entries, setEntries] = useState<UtangEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<CustomerLight[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [cachedTime, setCachedTime] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const [selectedCustomerId, setSelectedCustomerId] = useState<number>(0);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [lines, setLines] = useState<UtangItemLine[]>([{ productId: 0, quantity: 1, unitPrice: 0 }]);
  const [note, setNote] = useState('');

  const [paySelectedCustomerId, setPaySelectedCustomerId] = useState<number>(0);
  const [payNewCustomerName, setPayNewCustomerName] = useState('');
  const [payShowNewCustomer, setPayShowNewCustomer] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ customerId: number; customerName: string } | null>(null);
  const [deleteAdminUsername, setDeleteAdminUsername] = useState('');
  const [deleteAdminPassword, setDeleteAdminPassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

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

      getProducts()
        .then((prods) => setProducts(prods.filter((p) => !p.archived)))
        .catch(() => {});

      getCustomersLight()
        .then(setCustomers)
        .catch(() => {});
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

  const customerMap = new Map<string, { balance: number; entries: UtangEntry[]; customerId: number }>();
  for (const e of entries) {
    const key = e.customer?.name || 'Unknown';
    const existing = customerMap.get(key) ?? { balance: 0, entries: [], customerId: 0 };
    existing.balance += e.remainingBalance;
    existing.entries.push(e);
    if (e.customer?.id) existing.customerId = e.customer.id;
    customerMap.set(key, existing);
  }

  const filteredCustomers = Array.from(customerMap.entries()).filter(([name]) =>
    name.toLowerCase().includes(search.toLowerCase())
  );
  const totalOutstanding = Array.from(customerMap.values()).reduce((s, c) => s + c.balance, 0);
  const customersWithUtang = Array.from(customerMap.values()).filter((c) => c.balance > 0).length;

  function updateLine(i: number, field: keyof UtangItemLine, value: number) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  async function resolveCustomer(isNew: boolean, existingId: number, newName: string): Promise<string> {
    if (isNew && newName.trim()) {
      const created = await addCustomer({ name: newName.trim() });
      return created.name;
    }
    const found = customers.find((c) => c.id === existingId);
    return found?.name || '';
  }

  async function handleAddUtang(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      let customerName = '';
      if (showNewCustomer) {
        if (!newCustomerName.trim()) {
          setError('Enter a customer name');
          return;
        }
        customerName = newCustomerName.trim();
        const existing = customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase());
        if (!existing) {
          await addCustomer({ name: customerName });
        }
      } else {
        const found = customers.find((c) => c.id === selectedCustomerId);
        if (!found) {
          setError('Select a customer');
          return;
        }
        customerName = found.name;
      }

      const validLines = lines.filter((l) => l.productId > 0);
      if (validLines.length === 0) {
        setError('Add at least one item');
        return;
      }

      const res = await addUtang({
        customerName,
        items: validLines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
        note,
      });
      if (res?.offline) {
        setNotice('Utang entry queued offline! It will automatically sync once online.');
      }
      setShowAdd(false);
      setSelectedCustomerId(0);
      setNewCustomerName('');
      setShowNewCustomer(false);
      setLines([{ productId: 0, quantity: 1, unitPrice: 0 }]);
      setNote('');
      // Force fresh fetch from API after mutation
      try {
        const freshEntries = await refetchUtangEntries<UtangEntry>();
        setEntries(freshEntries);
        saveCategory2Cache('utang', freshEntries);
        setIsCached(false);
        setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
      } catch {
        refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add utang');
    }
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');

    let customerName = '';
    if (payShowNewCustomer) {
      if (!payNewCustomerName.trim()) {
        setError('Enter a customer name');
        return;
      }
      customerName = payNewCustomerName.trim();
      const existing = customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase());
      if (!existing) {
        await addCustomer({ name: customerName });
      }
    } else {
      const found = customers.find((c) => c.id === paySelectedCustomerId);
      if (!found) {
        setError('Select a customer');
        return;
      }
      customerName = found.name;
    }

    const targetCustomer = customerMap.get(customerName);
    const expectedBalance = targetCustomer ? targetCustomer.balance - Number(payAmount) : undefined;

    try {
      const res = await recordUtangPayment({
        customerName,
        amount: Number(payAmount),
        note: payNote,
        expectedBalance,
      });
      if (res?.offline) {
        setNotice('Utang payment queued offline! It will auto-post on reconnect.');
      }
      setShowPayment(false);
      setPaySelectedCustomerId(0);
      setPayNewCustomerName('');
      setPayShowNewCustomer(false);
      setPayAmount('');
      setPayNote('');
      // Force fresh fetch from API after mutation
      try {
        const freshEntries = await refetchUtangEntries<UtangEntry>();
        setEntries(freshEntries);
        saveCategory2Cache('utang', freshEntries);
        setIsCached(false);
        setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
      } catch {
        refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    }
  }

  async function handleDeleteCustomer() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setError('');
    try {
      await deleteCustomer(deleteTarget.customerId, deleteAdminUsername, deleteAdminPassword);
      setDeleteTarget(null);
      setDeleteAdminUsername('');
      setDeleteAdminPassword('');
      const freshEntries = await refetchUtangEntries<UtangEntry>();
      setEntries(freshEntries);
      saveCategory2Cache('utang', freshEntries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete customer');
    } finally {
      setDeleteLoading(false);
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
          <p className="text-sm text-slate-400">Track customer credit balances and payments.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowPayment(true); setError(''); }} className="border border-slate-700 hover:bg-slate-800 text-slate-200 rounded-xl px-4 py-2 text-sm font-semibold transition cursor-pointer">
            Record Payment
          </button>
          <button onClick={() => { setShowAdd(true); setError(''); }} className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2 text-sm font-semibold transition cursor-pointer">
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
        {filteredCustomers.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">No customers yet.</p>
        ) : (
          <table className="min-w-[500px] w-full text-sm">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-2">Customer</th>
                <th>Balance</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {filteredCustomers.map(([name, c]) => (
                <tr key={name} className="hover:bg-slate-900/50">
                  <td className="py-2.5 font-medium text-slate-100">{name}</td>
                  <td className="font-semibold text-rose-400">₱{c.balance.toFixed(2)}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.balance === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      {c.balance === 0 ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td className="text-right">
                    {c.balance === 0 && c.customerId > 0 && (
                      <button
                        onClick={() => setDeleteTarget({ customerId: c.customerId, customerName: name })}
                        className="text-xs text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                      >
                        Delete
                      </button>
                    )}
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
                <th>Last Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-900/50">
                  <td className="py-2.5 text-slate-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td className="font-medium text-slate-100">{e.customer?.name || 'Unknown'}</td>
                  <td className="text-slate-300">{e.items?.map((i) => `${i.product?.name || 'Item'} x${i.quantity}`).join(', ') || '—'}</td>
                  <td className="text-slate-400">{e.note || '—'}</td>
                  <td className="font-semibold text-emerald-400">₱{e.totalAmount.toFixed(2)}</td>
                  <td className="text-slate-400">
                    {e.paymentAllocations && e.paymentAllocations.length > 0
                      ? new Date(e.paymentAllocations[0].payment.createdAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      e.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300' :
                      e.status === 'partial' ? 'bg-sky-500/20 text-sky-300' :
                      'bg-amber-500/20 text-amber-300'
                    }`}>
                      {e.status === 'paid' ? 'Paid' : e.status === 'partial' ? 'Partial' : 'Unpaid'}
                    </span>
                  </td>
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
              <h3 className="font-bold text-lg text-white">Add Utang {isOffline && '(Offline)'}</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div>
              <label className="text-sm font-medium text-slate-300">Customer</label>
              {showNewCustomer ? (
                <div className="flex gap-2 mt-1">
                  <input
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Enter customer name"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                  />
                  <button type="button" onClick={() => { setShowNewCustomer(false); setNewCustomerName(''); }} className="text-xs text-slate-400 hover:text-white px-2 cursor-pointer">Cancel</button>
                </div>
              ) : (
                <div className="flex gap-2 mt-1">
                  <select
                    required
                    value={selectedCustomerId || ''}
                    onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                  >
                    <option value="">Select customer</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setShowNewCustomer(true)} className="text-xs text-cyan-400 font-semibold hover:underline whitespace-nowrap cursor-pointer">+ New</button>
                </div>
              )}
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
              <button type="button" onClick={() => setLines([...lines, { productId: 0, quantity: 1, unitPrice: 0 }])} className="text-xs text-cyan-400 font-semibold hover:underline cursor-pointer">+ Add another item</button>
            </div>
            <p className="text-sm font-semibold text-emerald-400">Total: ₱{lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0).toFixed(2)}</p>
            <div>
              <label className="text-sm font-medium text-slate-300">Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Cancel</button>
              <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">Add Utang</button>
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
              <button type="button" onClick={() => setShowPayment(false)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div>
              <label className="text-sm font-medium text-slate-300">Customer</label>
              {payShowNewCustomer ? (
                <div className="flex gap-2 mt-1">
                  <input
                    required
                    value={payNewCustomerName}
                    onChange={(e) => setPayNewCustomerName(e.target.value)}
                    placeholder="Enter customer name"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                  />
                  <button type="button" onClick={() => { setPayShowNewCustomer(false); setPayNewCustomerName(''); }} className="text-xs text-slate-400 hover:text-white px-2 cursor-pointer">Cancel</button>
                </div>
              ) : (
                <div className="flex gap-2 mt-1">
                  <select
                    required
                    value={paySelectedCustomerId || ''}
                    onChange={(e) => setPaySelectedCustomerId(Number(e.target.value))}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500"
                  >
                    <option value="">Select customer</option>
                    {customers.map((c) => {
                      const bal = customerMap.get(c.name)?.balance ?? 0;
                      return (
                        <option key={c.id} value={c.id}>{c.name}{bal > 0 ? ` (₱${bal.toFixed(2)} owed)` : ''}</option>
                      );
                    })}
                  </select>
                  <button type="button" onClick={() => setPayShowNewCustomer(true)} className="text-xs text-cyan-400 font-semibold hover:underline whitespace-nowrap cursor-pointer">+ New</button>
                </div>
              )}
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
              <button type="button" onClick={() => setShowPayment(false)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Cancel</button>
              <button type="submit" className="bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">Record Payment</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Customer Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Delete Customer</h3>
              <button type="button" onClick={() => { setDeleteTarget(null); setDeleteAdminUsername(''); setDeleteAdminPassword(''); }} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <p className="text-sm text-slate-300">
              Are you sure you want to delete <span className="font-semibold text-white">{deleteTarget.customerName}</span>? This requires admin authorization.
            </p>
            <div>
              <label className="text-sm font-medium text-slate-300">Admin Username</label>
              <input
                value={deleteAdminUsername}
                onChange={(e) => setDeleteAdminUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Admin Password</label>
              <input
                type="password"
                value={deleteAdminPassword}
                onChange={(e) => setDeleteAdminPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteAdminUsername(''); setDeleteAdminPassword(''); }}
                className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCustomer}
                disabled={!deleteAdminUsername || !deleteAdminPassword || deleteLoading}
                className="bg-rose-600 hover:bg-rose-500 text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {deleteLoading ? 'Deleting...' : 'Delete Customer'}
              </button>
            </div>
          </div>
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
