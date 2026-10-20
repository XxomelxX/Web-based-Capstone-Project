'use client';

import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { getFifoBatches, type FifoBatch } from '@/lib/client/api/inventory';
import { peso } from '@/lib/money';

interface LowStockProduct {
  id: number;
  name: string;
  stock: number;
  /** Base selling price / unit cost (centavos) — fallbacks when a layer omits its own. */
  price: number;
  cost: number;
}

interface FifoLayersProps {
  product: LowStockProduct | null;
  isVisible: boolean;
  onClose: () => void;
}

/** Per-layer profit (centavos), following the server's charge convention. */
interface LayerProfit {
  /** Sale price − unit cost for this layer. */
  perUnit: number;
  /** Units already sold from this layer × per-unit profit (realized). */
  earned: number;
  /** Units still on hand × per-unit profit (realizable). */
  left: number;
}

/**
 * Profit for one FIFO layer — same fallback the server charges with:
 * layer pricePerUnit ?? product.price, layer costPerUnit ?? product.cost.
 * Returns null when the selling price isn't truly known (e.g. zero base
 * price) rather than reporting a made-up margin.
 */
function layerProfit(batch: FifoBatch, product: LowStockProduct): LayerProfit | null {
  const price =
    typeof batch.pricePerUnit === 'number' && Number.isFinite(batch.pricePerUnit)
      ? batch.pricePerUnit
      : product.price > 0 && Number.isFinite(product.price)
        ? product.price
        : null;
  const cost =
    typeof batch.costPerUnit === 'number' && Number.isFinite(batch.costPerUnit)
      ? batch.costPerUnit
      : Number.isFinite(product.cost)
        ? product.cost
        : null;
  if (price === null || cost === null) return null;

  const perUnit = price - cost;
  const onHand = Math.max(0, batch.quantityRemaining);
  const sold = Math.max(0, batch.quantityReceived - batch.quantityRemaining);
  return { perUnit, earned: sold * perUnit, left: onHand * perUnit };
}

export function FifoLayers({ product, isVisible, onClose }: FifoLayersProps) {
  const [layers, setLayers] = useState<FifoBatch[]>([]);
  const [layersTotals, setLayersTotals] = useState<{ remainingTotal: number; remainingValue: number; unlayered: number } | null>(null);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState('');
  const [layersStale, setLayersStale] = useState(false);
  // Monotonic request token: a slow response for product A must never land
  // after a newer request for product B (click A then B quickly). Incremented
  // in the handler, never in render.
  const loadTokenRef = useRef(0);

  const loadLayers = useCallback(async () => {
    if (!product) return;
    const token = ++loadTokenRef.current;
    setLayers([]);
    setLayersTotals(null);
    setLayersError('');
    setLayersStale(false);
    setLayersLoading(true);
    try {
      const data = await getFifoBatches(product.id);
      if (loadTokenRef.current !== token) return; // superseded by a newer open
      setLayers(data.batches);
      setLayersTotals(data.totals);
      if (data.offline) setLayersStale(true);
    } catch (err) {
      if (loadTokenRef.current !== token) return;
      // Defensive: getFifoBatches already maps network failures to friendly
      // messages — never let a raw "Failed to fetch" reach the modal.
      const msg = err instanceof Error ? err.message : '';
      const isNetwork = err instanceof TypeError || /failed to fetch|network/i.test(msg);
      setLayersError(isNetwork ? 'Offline — FIFO layers become available after you reconnect once.' : msg || 'Failed to load stock layers');
    } finally {
      // Only the newest request owns the spinner; a stale settle must not hide
      // the loading state of the request that replaced it.
      if (loadTokenRef.current === token) setLayersLoading(false);
    }
  }, [product]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isVisible && product) void loadLayers();
  }, [isVisible, product, loadLayers]);

  // Shelf-stack display order (visual only — FIFO consumption is unchanged):
  // layers with stock float to the top with the newest restock on top; layers
  // that sold out sink below the stack. `sellingIndex` points at the oldest
  // stocked layer (bottom of the stocked group) — the one sales actually
  // consume, so its original "Selling from here" highlight stays truthful.
  const { ordered, sellingIndex } = useMemo(() => {
    const byNewest = (a: FifoBatch, b: FifoBatch) =>
      new Date(b.dateReceived).getTime() - new Date(a.dateReceived).getTime() || b.id - a.id;
    const stocked = layers.filter((b) => b.quantityRemaining > 0).sort(byNewest);
    const soldOut = layers.filter((b) => b.quantityRemaining <= 0).sort(byNewest);
    return { ordered: [...stocked, ...soldOut], sellingIndex: stocked.length - 1 };
  }, [layers]);

  // Per-layer profit rows keyed by batch id, plus the total realizable profit
  // across layers whose numbers are known (legacy/unlayered stock excluded —
  // it has no layer cost/price of its own).
  const profitByBatch = useMemo(() => {
    if (!product) return null;
    const rows = new Map<number, LayerProfit>();
    let totalLeft = 0;
    for (const b of layers) {
      const p = layerProfit(b, product);
      if (p) {
        rows.set(b.id, p);
        totalLeft += p.left;
      }
    }
    return rows.size > 0 ? { rows, totalLeft } : null;
  }, [layers, product]);

  if (!isVisible || !product) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="font-bold text-lg text-white">FIFO Layers: {product.name}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">×</button>
        </div>
        {layersError && <p className="text-sm text-rose-400">{layersError}</p>}
        {layersStale && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
            Offline — showing layers from your last sync.
          </p>
        )}
        {layersLoading && <p className="text-sm text-slate-400">Loading layers…</p>}
        {!layersLoading && layersTotals && (
          <p className="text-xs text-slate-400">
            On hand: <span className="text-white font-bold">{layersTotals.remainingTotal}</span>
            {' · '}Stock value: <span className="text-emerald-400 font-bold">{peso(layersTotals.remainingValue)}</span>
            {' · '}Profit on hand: <span className={profitByBatch && profitByBatch.totalLeft >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              {profitByBatch ? peso(profitByBatch.totalLeft) : '—'}
            </span>
            {layersTotals.unlayered > 0 && (
              <> · <span className="text-amber-400">{layersTotals.unlayered} unlayered (legacy stock)</span></>
            )}
          </p>
        )}
        {!layersLoading && layers.length === 0 && !layersError && (
          <p className="text-sm text-slate-500 text-center py-4">No recorded layers yet — restock to create the first FIFO layer.</p>
        )}
        {!layersLoading && ordered.length > 0 && (
          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {ordered.map((b, i) => (
              <div key={b.id} className={`border rounded-lg px-3 py-2 text-sm ${i === sellingIndex ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-800'}`}>
                <div className="flex justify-between items-center">
                  <span className={`font-semibold ${i === sellingIndex ? 'text-amber-200' : 'text-slate-100'}`}>
                    {i === sellingIndex ? '🟠 Selling from here (oldest)' : `Layer ${(i % 10) + 1}`}
                  </span>
                  <span className={b.quantityRemaining > 0 ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                    {b.quantityRemaining}/{b.quantityReceived} left
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {new Date(b.dateReceived).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  {b.supplier ? ` · ${b.supplier}` : ''}
                  {typeof b.pricePerUnit === 'number' ? ` · ${peso(b.pricePerUnit)} sale` : ''}
                  {b.costPerUnit != null
                    ? typeof b.pricePerUnit === 'number'
                      ? ` · ${peso(Number(b.costPerUnit))}/unit cost`
                      : ` · ${peso(Number(b.costPerUnit))}/unit`
                    : ''}
                </div>
                {(() => {
                  const profit = profitByBatch?.rows.get(b.id);
                  if (!profit) return null;
                  const negative = profit.perUnit < 0;
                  return (
                    <div className={`text-xs mt-1 font-semibold ${negative ? 'text-rose-400' : 'text-emerald-400'}`}>
                      Profit {peso(profit.perUnit)}/unit
                      {profit.earned !== 0 && <> · {peso(profit.earned)} earned</>}
                      {profit.left !== 0 && <> · {peso(profit.left)} on hand</>}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-400">
          Newly restocked layers stack on top and layers that sell out sink below — numbering cycles 1–10.
          Sales still consume the price of the oldest layer with stock.
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Close</button>
        </div>
      </div>
    </div>
  );
}
