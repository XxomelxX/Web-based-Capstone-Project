'use client';

import { useEffect, useState } from 'react';
import { getLowStock, restockProduct } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface LowStockProduct {
  id: number;
  name: string;
  category?: { name: string };
  price: number;
  stock: number;
  barcode?: string;
}

export default function LowStockPage() {
  const [products, setProducts] = useState<LowStockProduct[]>([]);
  const [threshold, setThreshold] = useState(20);
  const [search, setSearch] = useState('');
  const [restockTarget, setRestockTarget] = useState<LowStockProduct | null>(null);
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState('');

  function refresh() {
    getLowStock().then((res) => {
      setProducts(res.products as unknown as LowStockProduct[]);
      setThreshold(res.threshold);
    });
  }

  useRealtime({
    restock: refresh,
    products: refresh,
  });

  useEffect(refresh, []);

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const critical = products.filter((p) => p.stock < 10).length;
  const warning = products.filter((p) => p.stock >= 10 && p.stock < threshold).length;

  async function handleRestock(e: React.FormEvent) {
    e.preventDefault();
    if (!restockTarget) return;
    setError('');
    try {
      await restockProduct({ productId: restockTarget.id, quantity: Number(quantity) });
      setRestockTarget(null);
      setQuantity('');
      refresh(); // product disappears automatically once above threshold
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restock failed');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          Low Stock Items <span className="text-red-600 text-base">({products.length})</span>
        </h1>
        <p className="text-sm text-gray-500">Products below {threshold} units that need restocking</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label={`Critical (<10)`} value={critical} accent="text-red-600" />
        <StatCard label="Warning (10-19)" value={warning} />
        <StatCard label="Total Restock Needed" value={products.length} />
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search low stock items..."
        className="w-full border rounded-md px-4 py-2 bg-white"
      />

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Current Stock</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3">{p.name}</td>
                <td className="p-3">{p.category?.name}</td>
                <td className="p-3">₱{p.price}</td>
                <td className="p-3">
                  <span className="bg-red-100 text-red-700 rounded-full px-2 py-0.5 text-xs">{p.stock}</span>
                </td>
                <td className="p-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${p.stock < 10 ? 'bg-red-600 text-white' : 'bg-yellow-100 text-yellow-800'}`}>
                    {p.stock < 10 ? 'CRITICAL' : 'WARNING'}
                  </span>
                </td>
                <td className="p-3">
                  <button
                    onClick={() => setRestockTarget(p)}
                    className="text-xs bg-green-700 text-white rounded px-3 py-1"
                  >
                    Restock
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-gray-400">No low stock items 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {restockTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRestock} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">Restock: {restockTarget.name}</h3>
              <button type="button" onClick={() => setRestockTarget(null)}>×</button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Quantity to Add</label>
              <input
                required
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full border rounded-md px-3 py-2 mt-1"
              />
            </div>
            <p className="text-xs text-gray-500">
              Current stock: {restockTarget.stock} → New stock: {restockTarget.stock + (Number(quantity) || 0)}
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setRestockTarget(null)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-green-700 text-white rounded-md px-4 py-2 text-sm">Add Stock</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${accent ?? ''}`}>{value}</p>
    </div>
  );
}
