'use client';

import { useState } from 'react';
import { restockProduct } from '@/lib/client/api/inventory';
import { useOnline } from '@/components/providers/online-provider';
import { parsePesosToCents, peso } from '@/lib/money';

interface LowStockProduct {
  id: number;
  name: string;
  stock: number;
  price?: number;
}

interface StockInProps {
  product: LowStockProduct | null;
  isVisible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function StockIn({ product, isVisible, onClose, onSuccess }: StockInProps) {
  if (!isVisible || !product) return null;
  // Remount per target: a previous product's quantity/supplier/cost/price must
  // never prefill the next modal. The key also covers switching targets without
  // an intermediate close; returning null unmounts on close.
  return <StockInForm key={product.id} product={product} onClose={onClose} onSuccess={onSuccess} />;
}

function StockInForm({
  product,
  onClose,
  onSuccess,
}: {
  product: LowStockProduct;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [supplier, setSupplier] = useState('');
  const [costPerUnit, setCostPerUnit] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [error, setError] = useState('');
  const { isOnline } = useOnline();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await restockProduct({
        productId: product.id,
        quantity: Number(quantity),
        supplier: supplier.trim() || undefined,
        costPerUnit: costPerUnit === '' ? undefined : parsePesosToCents(costPerUnit),
        pricePerUnit: pricePerUnit === '' ? undefined : parsePesosToCents(pricePerUnit),
      });
      setQuantity('');
      setSupplier('');
      setCostPerUnit('');
      setPricePerUnit('');
      setError('');
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restock failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="font-bold text-lg text-white">Restock: {product.name}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">×</button>
        </div>
        {!isOnline && (
          <p className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
            Offline — stock updates locally and syncs when you reconnect.
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
        <div>
          <label className="text-sm font-medium text-slate-300">Supplier (optional)</label>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="e.g. Puregold, supplier name…"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-300">Cost per Unit ₱ (optional)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={costPerUnit}
            onChange={(e) => setCostPerUnit(e.target.value)}
            placeholder="Records this layer's buying cost"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-300">Selling Price per Unit ₱ (optional)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={pricePerUnit}
            onChange={(e) => setPricePerUnit(e.target.value)}
            placeholder="Records this layer's selling price"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-cyan-500 mt-1"
          />
          <p className="text-xs text-slate-500 mt-1">
            {typeof product.price === 'number'
              ? `Blank = sell at current price (${peso(product.price)})`
              : 'Blank = sell at the product’s current price'}
          </p>
        </div>
        <p className="text-xs text-slate-400">
          Current stock: {product.stock} → New stock: {product.stock + (Number(quantity) || 0)}
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">Cancel</button>
          <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">{isOnline ? 'Add Stock' : 'Queue Restock'}</button>
        </div>
      </form>
    </div>
  );
}
