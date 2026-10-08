'use client';

import { useEffect, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, mergeTransactions } from '@/lib/client/offline';
import {
  getTransactions, voidTransaction,
  requestVoid, getVoidRequests, cancelVoidRequest, reviewVoidRequest,
  type VoidRequest,
} from '@/lib/client/api/inventory';
import { useRealtime } from '@/lib/client/hooks/use-realtime';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { useCurrentUser } from '@/lib/client/hooks/useCurrentUser';

interface OrderItem { productId: number; quantity: number; unitPrice: number; lineTotal: number; product: { name: string } }
interface Order {
  id: number; createdAt: string; total: number; status: string; paymentMethod: string;
  voidReason?: string; cashier: { fullName: string }; customer?: { name: string } | null; items: OrderItem[];
  pendingSync?: boolean;
}

// Coerce any cached/server row into a render-safe Order. Never throws.
function normalizeOrder(raw: unknown): Order {
  const o = (raw ?? {}) as Record<string, unknown>;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items: OrderItem[] = itemsRaw.map((ri) => {
    const r = (ri ?? {}) as Record<string, unknown>;
    const qty = Number(r.quantity) || 0;
    const price = Number(r.unitPrice) || 0;
    const prod = (r.product ?? {}) as { name?: unknown };
    return {
      productId: Number(r.productId) || 0,
      quantity: qty,
      unitPrice: price,
      lineTotal: Number(r.lineTotal) || qty * price,
      product: { name: typeof prod.name === 'string' ? prod.name : 'Item' },
    };
  });
  const cashier = (o.cashier ?? {}) as { fullName?: unknown };
  const customer = (o.customer ?? null) as { name?: unknown } | null;
  return {
    id: Number(o.id) || 0,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
    total: Number(o.total) || 0,
    status: typeof o.status === 'string' ? o.status : 'complete',
    paymentMethod: typeof o.paymentMethod === 'string' ? o.paymentMethod : 'cash',
    voidReason: typeof o.voidReason === 'string' ? o.voidReason : undefined,
    cashier: { fullName: typeof cashier.fullName === 'string' ? cashier.fullName : '—' },
    customer: customer && typeof customer.name === 'string' ? { name: customer.name } : null,
    items,
    pendingSync: o.pendingSync === true,
  };
}

export default function OrdersClient() {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const liveOrders = useLiveQuery(() => db.transactions.toArray().catch(() => []));
  const liveVoidMirror = useLiveQuery(() => db.voidRequests.toArray().catch(() => []));
  const [viewing, setViewing] = useState<Order | null>(null);
  const [voiding, setVoiding] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState<VoidRequest | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [isOffline, setIsOffline] = useState(
    () => typeof window !== 'undefined' && !navigator.onLine
  );
  const [isLoading, setIsLoading] = useState(true);
  const [voidRequests, setVoidRequests] = useState<VoidRequest[]>([]);

  const orders: Order[] = (liveOrders ?? []).map(normalizeOrder).filter((o) => o.id !== 0);
  // Mirror rows (offline-first) merged with the last server pull.
  const mirrorPending = ((liveVoidMirror ?? []) as unknown as VoidRequest[]).filter(
    (r) => r && r.status === 'pending' && typeof r.transactionId === 'number'
  );

  const refresh = useCallback(async () => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    setLoadError('');
    if (offlineNow) {
      try {
        const cached = await getTransactions<Order>();
        setIsCached(cached.length === 0);
      } catch { setIsCached(true); }
      try {
        const local = await getVoidRequests();
        setVoidRequests(local);
      } catch { /* mirror read best-effort */ }
      setIsLoading(false);
      return;
    }

    try {
      const txs = await getTransactions<Order>();
      try {
        await mergeTransactions(txs as unknown as Record<string, unknown>[]);
      } catch { /* cache write best-effort — keep old cache */ }
      setIsCached(false);
    } catch (err) {
      setIsCached(true);
      setLoadError(err instanceof Error ? err.message : 'Failed to refresh orders. Showing cached data.');
    }
    try {
      const reqs = await getVoidRequests();
      setVoidRequests(reqs);
    } catch { /* approve queue best-effort */ }
    setIsLoading(false);
  }, []);

  useRealtime({
    transactions: () => { refresh().catch(() => {}); },
  });

  useEffect(() => {
    refresh().catch(() => setIsLoading(false));
    function handleReconnect() { refresh().catch(() => {}); }
    function handleOnline() { setIsOffline(false); refresh().catch(() => {}); }
    function handleOffline() { setIsOffline(true); }
    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refresh]);

  const sortedOrders = [...orders].sort((a, b) => {
    if (a.status === 'voided' && b.status !== 'voided') return 1;
    if (a.status !== 'voided' && b.status === 'voided') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const completeOrders = sortedOrders.filter((o) => o.status === 'complete');
  const totalRevenue = completeOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const totalItems = completeOrders.reduce((s, o) => s + o.items.reduce((si, i) => si + (Number(i.quantity) || 0), 0), 0);

  // Union of server pull + offline mirror, deduped by id/clientUuid.
  const pendingRequests: VoidRequest[] = (() => {
    const map = new Map<string, VoidRequest>();
    for (const r of [...voidRequests, ...mirrorPending]) {
      const key = typeof r.id === 'number' && r.id > 0
        ? `id:${r.id}`
        : `cu:${(r as { clientUuid?: string }).clientUuid ?? `neg:${r.id}`}`;
      if (!map.has(key)) map.set(key, r);
    }
    return [...map.values()].sort((a, b) =>
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );
  })();
  const requestedTxnIds = new Set(pendingRequests.map((r) => r.transactionId));

  function openVoidModal(o: Order) {
    setError('');
    setNotice('');
    setVoiding(o);
  }

  // Single void entry point:
  // - admin: direct void (online; offline direct voids are blocked server-side by design).
  // - cashier: void REQUEST (online + offline) → waits for admin approval.
  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voiding) return;
    setError('');
    setNotice('');
    try {
      if (isAdmin) {
        await voidTransaction(voiding.id, reason);
        setNotice(`Order #${voiding.id} voided.`);
      } else {
        await requestVoid(voiding.id, reason);
        setNotice(
          isOffline
            ? `Void requested for order #${voiding.id}. It will sync when you reconnect — an admin will approve it.`
            : `Void requested for order #${voiding.id}. Waiting for admin approval.`
        );
      }
      setVoiding(null);
      setReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Void failed');
    }
  }

  async function handleCancelRequest(id: number) {
    setError('');
    try {
      await cancelVoidRequest(id);
      setNotice('Void request cancelled.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  async function handleReview(approved: boolean) {
    if (!reviewing) return;
    setError('');
    try {
      await reviewVoidRequest(reviewing.id, approved, reviewNote || undefined);
      setNotice(
        approved
          ? (isOffline
            ? `Order #${reviewing.transactionId} approval queued — it will void on sync.`
            : `Order #${reviewing.transactionId} voided.`)
          : `Void request for order #${reviewing.transactionId} rejected.`
      );
      setReviewing(null);
      setReviewNote('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    }
  }

  return (
    <div className="space-y-4">
      <CachedDataBanner
        isOffline={isOffline}
        isCached={isCached}
        onRefresh={refresh}
      />

      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Orders</h1>
            <p className="text-sm text-slate-400">All sales transactions</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Total Orders" value={completeOrders.length} />
        <StatCard label="Items Sold" value={totalItems} />
        <StatCard label="Revenue" value={`₱${totalRevenue.toFixed(2)}`} accent="text-emerald-400" />
      </div>

      {loadError && (
        <div className="text-sm text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-md px-3 py-2 flex items-center justify-between gap-2">
          <span>{loadError}</span>
          <button onClick={() => refresh()} className="underline shrink-0 cursor-pointer">Retry</button>
        </div>
      )}
      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}
      {notice && <p className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-md px-3 py-2">{notice}</p>}

      {isAdmin && pendingRequests.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-amber-200">Void requests — needs approval ({pendingRequests.length})</h2>
            {isOffline && <span className="text-[11px] text-amber-300">Offline — approvals queue and sync on reconnect</span>}
          </div>
          <div className="space-y-2">
            {pendingRequests.map((r) => (
              <div key={r.id < 0 ? `temp-${r.id}` : r.id} className="flex flex-wrap items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-sm">
                <span className="text-cyan-400 font-semibold">#{r.transactionId}</span>
                <span className="text-slate-300">₱{(Number(r.orderTotal) || 0).toFixed(2)}</span>
                <span className="text-slate-400 text-xs">by {r.cashierName ?? `user #${r.requestedBy}`}</span>
                <span className="text-slate-300 text-xs italic truncate max-w-[220px]">“{r.reason}”</span>
                {(r.pendingSync || r.id < 0) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">sync pending</span>
                )}
                <span className="ml-auto flex gap-2">
                  <button
                    onClick={() => handleCancelRequest(r.id)}
                    className="text-[11px] text-slate-300 border border-slate-700 rounded-lg px-2.5 py-1 hover:bg-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { setReviewing(r); setReviewNote(''); setError(''); }}
                    className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-2.5 py-1 cursor-pointer"
                  >
                    Review
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-sm">Loading orders…</div>
      ) : sortedOrders.length === 0 ? (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-200 font-semibold">{isOffline ? 'No cached orders on this device' : 'No orders yet'}</p>
          <p className="text-slate-400 text-sm mt-1">{isOffline ? 'Sales made on this device will appear here. Reconnect to sync.' : 'Completed sales will appear here.'}</p>
        </div>
      ) : (
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
                <td className="p-3 text-right text-slate-300">{o.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)}</td>
                <td className="p-3 text-right font-semibold text-emerald-400">₱{(Number(o.total) || 0).toFixed(2)}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${o.status === 'voided' ? 'bg-slate-800 text-slate-400' : requestedTxnIds.has(o.id) ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}`}>
                    {o.status === 'voided' ? o.status : requestedTxnIds.has(o.id) ? 'void requested' : o.status}{o.pendingSync ? ' · sync pending' : ''}
                  </span>
                </td>
                <td className="p-3 space-x-2">
                  <button onClick={() => setViewing(o)} className="text-xs text-cyan-400 hover:underline cursor-pointer">View</button>
                  {o.status === 'complete' && !requestedTxnIds.has(o.id) && (
                    <button
                      onClick={() => openVoidModal(o)}
                      className="text-xs text-cyan-400 hover:underline cursor-pointer"
                    >
                      {isAdmin ? 'Void' : 'Request Void'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-sm w-full p-6 space-y-2 text-slate-200">
            <div className="flex justify-between items-center"><h3 className="font-bold text-white">Order #{viewing.id}</h3><button onClick={() => setViewing(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button></div>
            <p className="text-xs text-slate-400">{new Date(viewing.createdAt).toLocaleString()} · Cashier: {viewing.cashier?.fullName}</p>
            <div className="border-t border-slate-800 pt-2 space-y-1 text-sm">
              {viewing.items.map((i) => (
                <div key={i.productId} className="flex justify-between">
                  <span className="text-slate-300">{i.product.name} · {i.quantity} x ₱{i.unitPrice}</span>
                  <span className="text-slate-200">₱{(Number(i.lineTotal) || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-white"><span>Total</span><span className="text-emerald-400">₱{(Number(viewing.total) || 0).toFixed(2)}</span></div>
            {viewing.voidReason && <p className="text-xs text-rose-400">Voided: {viewing.voidReason}</p>}
          </div>
        </div>
      )}

      {voiding && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleVoid} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white">{isAdmin ? `Void Order #${voiding.id}` : `Request Void — Order #${voiding.id}`}</h3>
              <button type="button" onClick={() => setVoiding(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>
            <p className="text-xs text-slate-400">Total: ₱{(Number(voiding.total) || 0).toFixed(2)} · This will restore stock for all items.</p>
            {!isAdmin && (
              <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                {isOffline
                  ? 'Offline — your request will queue and sync when you reconnect. An admin will approve it.'
                  : 'An admin will review and approve this request.'}
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div>
              <label className="text-sm font-medium text-slate-300">Reason for Void</label>
              <input required value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" placeholder="e.g. Wrong item" />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setVoiding(null)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Cancel</button>
              <button type="submit" className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">
                {isAdmin ? 'Void Order' : (isOffline ? 'Request Void (Offline)' : 'Request Void')}
              </button>
            </div>
          </form>
        </div>
      )}

      {reviewing && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white">Approve Void — Order #{reviewing.transactionId}</h3>
              <button type="button" onClick={() => setReviewing(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>
            <p className="text-xs text-slate-400">
              Total: ₱{(Number(reviewing.orderTotal) || 0).toFixed(2)} · Requested by {reviewing.cashierName ?? `user #${reviewing.requestedBy}`}
            </p>
            <p className="text-sm text-slate-200 italic">“{reviewing.reason}”</p>
            {isOffline && (
              <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                Offline — approval queues and the order voids on sync.
              </p>
            )}
            <div>
              <label className="text-sm font-medium text-slate-300">Review note (optional)</label>
              <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1" placeholder="e.g. Verified with cashier" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setReviewing(null)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Close</button>
              <button type="button" onClick={() => handleReview(false)} className="border border-rose-700 text-rose-300 rounded-xl px-4 py-2 text-sm font-semibold hover:bg-rose-950/40 cursor-pointer">Reject</button>
              <button type="button" onClick={() => handleReview(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">
                {isOffline ? 'Queue Approval' : 'Approve & Void'}
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
