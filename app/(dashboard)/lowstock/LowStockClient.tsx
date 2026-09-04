'use client';

import { useEffect, useState, useCallback } from 'react';
import { getLowStock, restockProduct } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { getCategory2Cache, saveCategory2Cache } from '@/lib/localStorageCache';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { RECONNECT_EVENT_NAME } from '@/lib/useOfflineSync';

interface LowStockProduct {
  id: number;
  name: string;
  category?: { name: string };
  price: number;
  stock: number;
  barcode?: string;
}

interface LowStockResponse {
  threshold: number;
  products: LowStockProduct[];
}

export default function LowStockClient() {
  const [products, setProducts] = useState<LowStockProduct[]>([]);
  const [threshold, setThreshold] = useState(20);
  const [search, setSearch] = useState('');
  const [restockTarget, setRestockTarget] = useState<LowStockProduct | null>(null);
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [cachedTime, setCachedTime] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const refresh = useCallback(() => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);

    if (offlineNow) {
      const cached = getCategory2Cache<LowStockResponse>('lowstock');
      if (cached.data) {
        setProducts(cached.data.products || []);
        setThreshold(cached.data.threshold || 20);
        setIsCached(true);
        setCachedTime(cached.formattedTime || cached.cachedAt);
      }
    } else {
      getLowStock()
        .then((res) => {
          const prods = (res.products as unknown as LowStockProduct[]) || [];
          const thresh = res.threshold ?? 20;
          setProducts(prods);
          setThreshold(thresh);
          saveCategory2Cache('lowstock', { threshold: thresh, products: prods });
          setIsCached(false);
          setCachedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }));
        })
        .catch(() => {
          const cached = getCategory2Cache<LowStockResponse>('lowstock');
          if (cached.data) {
            setProducts(cached.data.products || []);
            setThreshold(cached.data.threshold || 20);
            setIsCached(true);
            setCachedTime(cached.formattedTime || cached.cachedAt);
          }
        });
    }
  }, []);

  useRealtime({
    restock: refresh,
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

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const critical = products.filter((p) => p.stock < 10).length;
  const warning = products.filter((p) => p.stock >= 10 && p.stock < threshold).length;

  function openRestockModal(p: LowStockProduct) {
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return;
    }
    setError('');
    setRestockTarget(p);
  }

  async function handleRestock(e: React.FormEvent) {
    e.preventDefault();
    if (!restockTarget) return;
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setError('This action requires an internet connection');
      return;
    }
    setError('');
    try {
      await restockProduct({ productId: restockTarget.id, quantity: Number(quantity) });
      setRestockTarget(null);
      setQuantity('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restock failed');
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
        <h1 className="text-2xl font-bold text-white">
          Low Stock Items <span className="text-rose-400 text-base">({products.length})</span>
        </h1>
        <p className="text-sm text-slate-400">Products below {threshold} units that need restocking</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label={`Critical (<10)`} value={critical} accent="text-rose-400" />
        <StatCard label="Warning (10-19)" value={warning} accent="text-amber-400" />
        <StatCard label="Total Restock Needed" value={products.length} accent="text-cyan-400" />
      </div>

      {error && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">{error}</p>}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search low stock items..."
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-cyan-500"
      />

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[600px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Current Stock</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-slate-900/50">
                <td className="p-3 font-medium text-slate-100">{p.name}</td>
                <td className="p-3 text-slate-400">{p.category?.name || 'Uncategorized'}</td>
                <td className="p-3 font-semibold text-emerald-400">₱{p.price}</td>
                <td className="p-3">
                  <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-2.5 py-0.5 text-xs font-semibold">{p.stock}</span>
                </td>
                <td className="p-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${p.stock < 10 ? 'bg-rose-600 text-white' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`}>
                    {p.stock < 10 ? 'CRITICAL' : 'WARNING'}
                  </span>
                </td>
                <td className="p-3">
                  <button
                    onClick={() => openRestockModal(p)}
                    disabled={isOffline}
                    className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded px-3 py-1 font-semibold transition cursor-pointer"
                    title={isOffline ? 'This action requires an internet connection' : 'Restock product'}
                  >
                    Restock
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500">No low stock items</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {restockTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRestock} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-white">Restock: {restockTarget.name}</h3>
              <button type="button" onClick={() => setRestockTarget(null)} className="text-slate-400 hover:text-white cursor-pointer">×</button>
            </div>
            {isOffline && (
              <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                This action requires an internet connection.
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div>
              <label className="text-sm font-medium text-slate-300">Quantity to Add</label>
              <input
                required
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
              />
            </div>
            <p className="text-xs text-slate-400">
              Current stock: {restockTarget.stock} → New stock: {restockTarget.stock + (Number(quantity) || 0)}
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setRestockTarget(null)} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Cancel</button>
              <button type="submit" disabled={isOffline} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">Add Stock</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}
