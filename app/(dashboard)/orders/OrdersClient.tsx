'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { getTransactions, voidTransaction } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { RECONNECT_EVENT_NAME } from '@/lib/useOfflineSync';

interface OrderItem { productId: number; quantity: number; unitPrice: number; lineTotal: number; product: { name: string } }
interface Order {
  id: number; createdAt: string; total: number; status: string; paymentMethod: string;
  voidReason?: string; cashier: { fullName: string }; customer?: { name: string } | null; items: OrderItem[];
}

export default function OrdersClient() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [viewing, setViewing] = useState<Order | null>(null);
  const [voiding, setVoiding] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [cachedTime, setCachedTime] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);

    if (offlineNow) {
      const cached = getCategory2Cache<Order[]>('transactions');
      if (cached.data) {
        setOrders(cached.data);
        setIsCached(true);
        setCachedTime(cached.formattedTime || cached.cachedAt);
      }
    } else {
      getTransactions<Order>()
        .then((txs) => {
          setOrders(txs);
          saveCategory2Cache('transactions', txs);
          setIsCached(false);
          setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
        })
        .catch(() => {
          const cached = getCategory2Cache<Order[]>('transactions');
          if (cached.data) {
            setOrders(cached.data);
            setIsCached(true);
            setCachedTime(cached.formattedTime || cached.cachedAt);
          }
        });
    }
  }, []);

  useRealtime({
    transactions: refresh,
  });

  useEffect(() => {
    refresh();

    function handleReconnect() {
      refresh();
    }

    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    return () => window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
  }, [refresh]);

  const sortedOrders = [...orders].sort((a, b) => {
    if (a.status === 'voided' && b.status !== 'voided') return 1;
    if (a.status !== 'voided' && b.status === 'voided') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const completeOrders = sortedOrders.filter((o) => o.status === 'complete');
  const totalRevenue = completeOrders.reduce((s, o) => s + o.total, 0);
  const totalItems = completeOrders.reduce((s, o) => s + o.items.reduce((si, i) => si + i.quantity, 0), 0);

  function openVoidModal(o: Order) {
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return;
    }
    setError('');
    setVoiding(o);
  }

  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voiding) return;
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return;
    }
    setError('');
    try {
      await voidTransaction(voiding.id, reason, adminUsername, adminPassword);
      setVoiding(null);
      setReason('');
      setAdminUsername('');
      setAdminPassword('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Void failed');
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

      <div>
        <h1 className="text-2xl font-bold text-white">Orders</h1>
        <p className="text-sm text-slate-400">All sales transactions</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Total Orders" value={completeOrders.length} />
        <StatCard label="Items Sold" value={totalItems} />
        <StatCard label="Revenue" value={`₱${totalRevenue.toFixed(2)}`} accent="text-emerald-400" />
      </div>

      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[600px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="p-3">No.</th>
              <th className="p-3">Order#</th>
              <th className="p-3">Date</th>
              <th className="p-3">Cashier</th>
              <th className="p-3 text-right">Items</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {sortedOrders.map((o, index) => (
              <tr key={o.id} className="hover:bg-slate-900/50">
                <td className="p-3 font-medium text-slate-400">{index + 1}</td>
                <td className="p-3 text-cyan-400">#{o.id}</td>
                <td className="p-3 text-slate-400">{new Date(o.createdAt).toLocaleString()}</td>
                <td className="p-3 text-slate-300">{o.cashier?.fullName || '—'}</td>
                <td className="p-3 text-right text-slate-300">{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                <td className="p-3 text-right font-semibold text-emerald-400">₱{o.total.toFixed(2)}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${o.status === 'voided' ? 'bg-slate-800 text-slate-400' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="p-3 space-x-2">
                  <button onClick={() => setViewing(o)} className="text-xs text-cyan-400 hover:underline">View</button>
                  {o.status === 'complete' && (
                    <button
                      onClick={() => openVoidModal(o)}
                      disabled={isOffline}
                      className="text-xs text-rose-400 hover:underline disabled:opacity-40"
                      title={isOffline ? 'This action requires an internet connection' : 'Void order'}
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-sm w-full p-6 space-y-2 text-slate-200">
            <div className="flex justify-between items-center"><h3 className="font-bold text-white">Order #{viewing.id}</h3><button onClick={() => setViewing(null)} className="text-slate-400 hover:text-white">✕</button></div>
            <p className="text-xs text-slate-400">{new Date(viewing.createdAt).toLocaleString()} · Cashier: {viewing.cashier?.fullName}</p>
            <div className="border-t border-slate-800 pt-2 space-y-1 text-sm">
              {viewing.items.map((i) => (
                <div key={i.productId} className="flex justify-between">
                  <span className="text-slate-300">{i.product.name} · {i.quantity} x ₱{i.unitPrice}</span>
                  <span className="text-slate-200">₱{i.lineTotal.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-white"><span>Total</span><span className="text-emerald-400">₱{viewing.total.toFixed(2)}</span></div>
            {viewing.voidReason && <p className="text-xs text-rose-400">Voided: {viewing.voidReason}</p>}
          </div>
        </div>
      )}

      {voiding && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleVoid} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3"><h3 className="font-bold text-white">Void Order #{voiding.id}</h3><button type="button" onClick={() => setVoiding(null)} className="text-slate-400 hover:text-white">✕</button></div>
            <p className="text-xs text-slate-400">Total: ₱{voiding.total.toFixed(2)} · This will restore stock for all items.</p>
            {isOffline && (
              <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                This action requires an internet connection.
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div>
              <label className="text-sm font-medium text-slate-300">Reason for Void</label>
              <input required value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" placeholder="e.g. Wrong item scanned" />
            </div>

            {session?.user?.role === 'cashier' && (
              <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 space-y-2">
                <div className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                  <span>🔒</span> Supervisor Credentials Required
                </div>
                <div>
                  <label className="text-xs text-slate-400 block">Admin Username</label>
                  <input
                    required
                    type="text"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-sm text-white outline-none focus:border-cyan-500"
                    placeholder="admin"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block">Admin Password</label>
                  <input
                    required
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-sm text-white outline-none focus:border-cyan-500"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setVoiding(null)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={isOffline} className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold">Void Order</button>
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
