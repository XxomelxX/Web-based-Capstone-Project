'use client';

import { useCallback, useState, useEffect } from 'react';
import { getFifoBatches, type FifoBatch } from '@/lib/client/api/inventory';
import { peso } from '@/lib/money';

interface LowStockProduct {
  id: number;
  name: string;
  stock: number;
}

interface FifoLayersProps {
  product: LowStockProduct | null;
  isVisible: boolean;
  onClose: () => void;
}

export function FifoLayers({ product, isVisible, onClose }: FifoLayersProps) {
  const [layers, setLayers] = useState<FifoBatch[]>([]);
  const [layersTotals, setLayersTotals] = useState<{ remainingTotal: number; remainingValue: number; unlayered: number } | null>(null);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState('');
  const [layersStale, setLayersStale] = useState(false);

  const loadLayers = useCallback(async () => {
    if (!product) return;
    setLayers([]);
    setLayersTotals(null);
    setLayersError('');
    setLayersStale(false);
    setLayersLoading(true);
    try {
      const data = await getFifoBatches(product.id);
      setLayers(data.batches);
      setLayersTotals(data.totals);
      if (data.offline) setLayersStale(true);
    } catch (err) {
      // Defensive: getFifoBatches already maps network failures to friendly
      // messages — never let a raw "Failed to fetch" reach the modal.
      const msg = err instanceof Error ? err.message : '';
      const isNetwork = err instanceof TypeError || /failed to fetch|network/i.test(msg);
      setLayersError(isNetwork ? 'Offline — FIFO layers become available after you reconnect once.' : msg || 'Failed to load stock layers');
    } finally {
      setLayersLoading(false);
    }
  }, [product]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isVisible && product) void loadLayers();
  }, [isVisible, product, loadLayers]);

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
            {layersTotals.unlayered > 0 && (
              <> · <span className="text-amber-400">{layersTotals.unlayered} unlayered (legacy stock)</span></>
            )}
          </p>
        )}
        {!layersLoading && layers.length === 0 && !layersError && (
          <p className="text-sm text-slate-500 text-center py-4">No recorded layers yet — restock to create the first FIFO layer.</p>
        )}
        {!layersLoading && layers.length > 0 && (
          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {layers.map((b, i) => (
              <div key={b.id} className={`border rounded-lg px-3 py-2 text-sm ${i === 0 && b.quantityRemaining > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-800'}`}>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-100">
                    {i === 0 && b.quantityRemaining > 0 ? '🟠 Selling from here (oldest)' : `Layer ${i + 1}`}
                  </span>
                  <span className={b.quantityRemaining > 0 ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                    {b.quantityRemaining}/{b.quantityReceived} left
                  </span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {new Date(b.dateReceived).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  {b.supplier ? ` · ${b.supplier}` : ''}
                  {b.costPerUnit != null ? ` · ${peso(Number(b.costPerUnit))}/unit` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Close</button>
        </div>
      </div>
    </div>
  );
}
