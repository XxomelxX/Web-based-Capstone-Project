'use client';

import { useState, useCallback, useEffect } from 'react';
import { getAdjustmentHistory, type AdjustmentHistoryItem } from '@/lib/client/api/inventory';
import { adjustmentTypeLabel } from '@/lib/adjustment';
import { useRealtime } from '@/lib/client/hooks/use-realtime';

interface AdjustmentHistoryProps {
  isVisible: boolean;
  onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  increase: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  decrease: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  // Legacy reason types (rows created before Increase/Decrease vocabulary).
  breakage: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  expired: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  theft: 'bg-red-500/20 text-red-300 border border-red-500/30',
  found: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  correction: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  other: 'bg-slate-500/20 text-slate-300 border border-slate-500/30',
};

export function AdjustmentHistory({ isVisible, onClose }: AdjustmentHistoryProps) {
  const [history, setHistory] = useState<AdjustmentHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    if (!isVisible) return;
    setLoading(true);
    try {
      const logs = await getAdjustmentHistory();
      setHistory(logs.slice(0, 100));
      setError('');
    } catch (err) {
      setHistory([]);
      setError(err instanceof Error ? err.message : 'Failed to load adjustment history');
    } finally {
      setLoading(false);
    }
  }, [isVisible]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isVisible) void loadHistory();
  }, [isVisible, loadHistory]);

  useRealtime({ itemlog: loadHistory });

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-800">
          <div>
            <h3 className="font-bold text-lg text-white">Stock Adjustment History</h3>
            <p className="text-xs text-slate-400">Every stock increase and decrease — latest 100</p>
          </div>
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
        <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
          {error && <p className="text-sm text-rose-400 p-4">{error}</p>}
          {!error && history.length === 0 ? (
            <p className="text-sm text-slate-500 p-6 text-center">
              No adjustments yet — use the &ldquo;Adjust&rdquo; button on a product to record one.
            </p>
          ) : (
            <table className="min-w-[640px] w-full text-sm">
              <thead className="bg-slate-950 text-left text-slate-400 sticky top-0">
                <tr>
                  <th className="p-3">Date</th>
                  <th className="p-3">Product</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Change</th>
                  <th className="p-3">Note</th>
                  <th className="p-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-950/50">
                    <td className="p-3 text-slate-400 whitespace-nowrap">
                      {new Date(h.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="p-3 font-medium text-slate-100">{h.product?.name ?? 'Item'}</td>
                    <td className="p-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded whitespace-nowrap ${TYPE_COLORS[h.adjustType ?? ''] ?? TYPE_COLORS.other}`}>
                        {adjustmentTypeLabel(h.adjustType)}
                      </span>
                    </td>
                    <td className={`p-3 font-semibold whitespace-nowrap ${h.quantity > 0 ? 'text-emerald-400' : h.quantity < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                      {h.quantity > 0 ? `+${h.quantity}` : h.quantity}
                    </td>
                    <td className="p-3 text-slate-400 max-w-[200px] truncate" title={h.note ?? ''}>
                      {h.note || '—'}
                    </td>
                    <td className="p-3 text-slate-400 whitespace-nowrap">{h.user?.fullName ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
