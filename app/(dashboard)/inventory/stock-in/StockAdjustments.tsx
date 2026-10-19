'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { adjustInventoryStock } from '@/lib/client/api/inventory';
import {
  ADJUSTMENT_TYPES,
  ADJUSTMENT_TYPE_LABELS,
  type AdjustmentType,
} from '@/lib/adjustment';

interface LowStockProduct {
  id: number;
  name: string;
  stock: number;
}

interface StockAdjustmentsProps {
  product: LowStockProduct | null;
  isVisible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const MODE_HINTS: Record<AdjustmentType, string> = {
  increase: 'Add units received / found to stock',
  decrease: 'Remove broken / expired units from stock',
};

export function StockAdjustments({ product, isVisible, onClose, onSuccess }: StockAdjustmentsProps) {
  // The adjustment type IS the direction — there is no separate direction
  // selector anymore, so `mode` mirrors the selected type.
  const [type, setType] = useState<AdjustmentType | ''>('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [queuedNote, setQueuedNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isVisible || !product) return null;

  // Closing clears transient state so a stale success/error note from the
  // previous submission can never show up in a fresh look at another product.
  const handleClose = () => {
    setError('');
    setQueuedNote('');
    onClose();
  };

  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty > 0;
  const mode = type === '' ? null : type;
  const target = mode && qtyValid ? (mode === 'increase' ? product.stock + qty : product.stock - qty) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    if (!mode) {
      setError('Select an adjustment type');
      return;
    }
    if (!qtyValid) {
      setError('Quantity must be a whole number of 1 or more');
      return;
    }
    if (mode === 'decrease' && qty > product.stock) {
      setError(`Cannot decrease by ${qty} — only ${product.stock} in stock`);
      return;
    }
    const trimmedNote = note.trim();
    setError('');
    setQueuedNote('');
    setIsSaving(true);
    try {
      const result = await adjustInventoryStock({
        productId: product.id,
        mode,
        type,
        quantity: qty,
        reason: trimmedNote || undefined,
      });
      setQuantity('');
      setNote('');
      setType('');
      if (result.offline) {
        // Success, not an error: Dexie already holds the optimistic stock.
        setQueuedNote(
          `Adjustment queued — ${result.product.stock} stock will apply on this device now and sync when you're back online.`
        );
        toast.success('Adjustment queued — it will sync when you are back online.');
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="font-bold text-lg text-white">Adjust Stock: {product.name}</h3>
          <button type="button" onClick={handleClose} className="text-slate-400 hover:text-white cursor-pointer">×</button>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {queuedNote && (
          <p className="text-xs text-amber-300 bg-amber-950/40 p-2 rounded border border-amber-800/40">{queuedNote}</p>
        )}

        <div>
          <label className="text-sm font-medium text-slate-300">Adjustment Type</label>
          <select
            required
            value={type}
            onChange={(e) => setType(e.target.value as AdjustmentType | '')}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1 cursor-pointer"
          >
            <option value="" disabled>
              Select type…
            </option>
            {ADJUSTMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ADJUSTMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {mode && <p className="text-xs text-slate-500 mt-1">{MODE_HINTS[mode]}</p>}
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300">
            Quantity to {mode === 'increase' ? 'Add' : 'Remove'}
          </label>
          <input
            required
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300">Note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. broken in transit, expired on shelf…"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
          />
        </div>

        <p className="text-xs text-slate-400">
          {target === null
            ? `System shows ${product.stock}`
            : `System shows ${product.stock} → sets to ${target} (${
                target - product.stock > 0 ? `+${target - product.stock}` : target - product.stock
              })`}
        </p>

        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer"
          >
            {isSaving ? 'Saving…' : 'Save Adjustment'}
          </button>
        </div>
      </form>
    </div>
  );
}
