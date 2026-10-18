'use client';

import { useState, useCallback, useEffect } from 'react';
import { getItemLog } from '@/lib/client/api/inventory';
import { adjustmentTypeLabel } from '@/lib/adjustment';

interface HistoryItem {
  id: number;
  action: string;
  quantity: number;
  adjustType?: string | null;
  note?: string | null;
  createdAt: string;
  product?: { name?: string };
  user?: { fullName?: string };
}

interface InventoryHistoryProps {
  isVisible: boolean;
  onClose: () => void;
}

export function InventoryHistory({ isVisible, onClose }: InventoryHistoryProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const logs = (await getItemLog()) as HistoryItem[];
      setHistory(logs.slice(0, 20));
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [isVisible]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isVisible) void loadHistory();
  }, [isVisible, loadHistory]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-800">
          <h3 className="font-bold text-lg text-white">Recent Inventory History</h3>
          <div className="flex gap-2">
            <button
              onClick={loadHistory}
              disabled={loading}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-3 py-1.5 font-semibold cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">×</button>
          </div>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500 p-4 text-center">Stock-ins, sales, adjustments and voids — tap &ldquo;Refresh&rdquo; to load the latest 20.</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {history.map((h) => (
                <div key={h.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded mr-2 ${
                      h.action === 'sold'
                        ? 'bg-cyan-500/20 text-cyan-300'
                        : h.action === 'restocked'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : h.action === 'adjusted'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-slate-500/20 text-slate-300'
                    }`}>
                      {h.action === 'sold' ? 'Sold' : h.action === 'restocked' ? 'Stock In' : h.action === 'adjusted' ? 'Adjusted' : h.action}
                    </span>
                    <span className="text-slate-200 truncate">{h.product?.name ?? 'Item'}</span>
                    <span className="text-slate-500 text-xs"> · {h.quantity > 0 ? `+${h.quantity}` : h.quantity} · {h.user?.fullName ?? ''}</span>
                    {h.action === 'adjusted' && (
                      <span className="text-xs text-amber-400/90">
                        {' · '}
                        {adjustmentTypeLabel(h.adjustType) || 'Adjustment'}
                        {h.note ? ` — ${h.note}` : ''}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {new Date(h.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

