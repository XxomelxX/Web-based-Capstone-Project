'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/client/offline';
import { getActiveProducts, type Product } from '@/lib/client/api/products';
import { getSettings } from '@/lib/client/api/inventory';
import { useRealtime } from '@/lib/client/hooks/use-realtime';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { SearchInput } from '@/components/SearchInput';
import { PageSkeleton } from '@/components/PageSkeleton';
import { useCurrentUser } from '@/lib/client/hooks/useCurrentUser';
import { StockIn } from './stock-in/StockIn';
import { StockAdjustments } from './stock-in/StockAdjustments';
import { FifoLayers } from './fifo-layers/FifoLayers';
import { InventoryHistory } from './history/InventoryHistory';
import { AdjustmentHistory } from './history/AdjustmentHistory';
import { peso } from '@/lib/money';

type StockStatus = 'critical' | 'warning' | 'ok';

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

export default function InventoryClient() {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'admin';

  // Dexie-backed product list: instant paint, reactive to offline restocks.
  const liveProducts = useLiveQuery(() => db.products.toArray());
  const products: Product[] = (liveProducts ?? []) as unknown as Product[];

  const [threshold, setThreshold] = useState(20);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  const [stockInTarget, setStockInTarget] = useState<Product | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [layersTarget, setLayersTarget] = useState<Product | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdjustHistory, setShowAdjustHistory] = useState(false);

  const refresh = useCallback(async () => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    try {
      // Active-only list that never wipes archived rows from Dexie.
      await getActiveProducts();
      const settings = await getSettings<{ lowStockThreshold?: number }>();
      setThreshold(settings?.lowStockThreshold ?? 20);
      setIsCached(false);
      setError('');
    } catch {
      // Live query already shows whatever Dexie holds — flag it as stale.
      setIsCached(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useRealtime({
    products: refresh,
    restock: refresh,
    itemlog: refresh,
    settings: refresh,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
    function handleReconnect() { refresh(); }
    function handleOffline() { setIsOffline(true); }
    function handleOnline() { setIsOffline(false); refresh(); }
    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [refresh]);

  const activeProducts = products.filter((p) => !p.archived);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? activeProducts.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode ?? '').toLowerCase().includes(q) ||
          (p.category?.name ?? '').toLowerCase().includes(q)
      )
    : activeProducts;

  const criticalCutoff = Math.floor(threshold / 2);
  const statusOf = (stock: number): StockStatus =>
    stock < criticalCutoff ? 'critical' : stock < threshold ? 'warning' : 'ok';
  const critical = activeProducts.filter((p) => statusOf(p.stock) === 'critical').length;
  const warning = activeProducts.filter((p) => statusOf(p.stock) === 'warning').length;
  const ok = activeProducts.length - critical - warning;

  if (loading && activeProducts.length === 0) {
    return <PageSkeleton variant="table" />;
  }

  return (
    <div className="space-y-4">
      <CachedDataBanner isOffline={isOffline} isCached={isCached} onRefresh={refresh} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Inventory <span className="text-cyan-400 text-base">({activeProducts.length})</span>
          </h1>
          <p className="text-sm text-slate-400">
            Stock levels, FIFO layers and restocking — below {threshold} units is flagged
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowAdjustHistory(true)}
              className="border border-amber-700/60 rounded-xl px-4 py-2 text-sm text-amber-300 hover:bg-amber-950/40 cursor-pointer"
            >
              Adjust History
            </button>
          )}
          <button
            onClick={() => setShowHistory(true)}
            className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer"
          >
            History
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total products" value={activeProducts.length} accent="text-white" />
        <StatCard label={`Critical (<${criticalCutoff})`} value={critical} accent="text-rose-400" />
        <StatCard label={`Warning (${criticalCutoff}–${threshold - 1})`} value={warning} accent="text-amber-400" />
        <StatCard label={`OK (≥${threshold})`} value={ok} accent="text-emerald-400" />
      </div>

      {error && (
        <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search product, barcode or category…"
        ariaLabel="Search inventory"
      />

      <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stock</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {filtered.map((p) => {
              const status = statusOf(p.stock);
              return (
                <tr key={p.id} className="hover:bg-slate-900/50">
                  <td className="p-3 font-medium text-slate-100">
                    {p.name}
                    {p.barcode && <span className="block text-xs text-slate-500">{p.barcode}</span>}
                  </td>
                  <td className="p-3 text-slate-400">{p.category?.name || 'Uncategorized'}</td>
                  <td className="p-3 font-semibold text-emerald-400">{peso(p.price)}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        status === 'critical'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : status === 'warning'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {p.stock}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded ${
                        status === 'critical'
                          ? 'bg-rose-600 text-white'
                          : status === 'warning'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {status === 'critical' ? 'CRITICAL' : status === 'warning' ? 'WARNING' : 'OK'}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => setStockInTarget(p)}
                            className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded px-3 py-1 font-semibold transition cursor-pointer"
                            title="Add stock (FIFO layer)"
                          >
                            Stock In
                          </button>
                          <button
                            onClick={() => setAdjustTarget(p)}
                            className="text-xs bg-amber-600 hover:bg-amber-500 text-white rounded px-3 py-1 font-semibold transition cursor-pointer"
                            title="Adjust stock: increase, decrease or recount"
                          >
                            Adjust
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setLayersTarget(p)}
                        className="text-xs border border-slate-700 hover:bg-slate-800 text-slate-300 rounded px-3 py-1 font-semibold transition cursor-pointer"
                        title="View FIFO stock layers"
                      >
                        Layers
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  {q ? `No products match "${search.trim()}"` : 'No products yet — add them on the Products page'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <StockIn
        product={stockInTarget}
        isVisible={!!stockInTarget}
        onClose={() => setStockInTarget(null)}
        onSuccess={refresh}
      />
      <StockAdjustments
        product={adjustTarget}
        isVisible={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onSuccess={refresh}
      />
      <FifoLayers
        product={layersTarget}
        isVisible={!!layersTarget}
        onClose={() => setLayersTarget(null)}
      />
      <InventoryHistory isVisible={showHistory} onClose={() => setShowHistory(false)} />
      <AdjustmentHistory isVisible={showAdjustHistory} onClose={() => setShowAdjustHistory(false)} />
    </div>
  );
}
