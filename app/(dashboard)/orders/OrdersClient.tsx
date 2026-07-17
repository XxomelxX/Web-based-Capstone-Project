'use client';

import { useEffect, useState } from 'react';
import { getTransactions, voidTransaction } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';

interface OrderItem { productId: number; quantity: number; unitPrice: number; lineTotal: number; product: { name: string } }
interface Order {
  id: number; createdAt: string; total: number; status: string; paymentMethod: string;
  voidReason?: string; cashier: { fullName: string }; items: OrderItem[];
}

export default function OrdersClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [viewing, setViewing] = useState<Order | null>(null);
  const [voiding, setVoiding] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function refresh() {
    getTransactions<Order>().then(setOrders);
  }

  useRealtime({
    transactions: refresh,
  });

  useEffect(refresh, []);

  const sortedOrders = [...orders].sort((a, b) => {
    if (a.status === 'voided' && b.status !== 'voided') return 1;
    if (a.status !== 'voided' && b.status === 'voided') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const completeOrders = sortedOrders.filter((o) => o.status === 'complete');
  const totalRevenue = completeOrders.reduce((s, o) => s + o.total, 0);
  const totalItems = completeOrders.reduce((s, o) => s + o.items.reduce((si, i) => si + i.quantity, 0), 0);

  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voiding) return;
    setError('');
    try {
      await voidTransaction(voiding.id, reason);
      setVoiding(null);
      setReason('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Void failed');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-sm text-gray-500">All sales transactions</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard label="Total Orders" value={completeOrders.length} />
        <StatCard label="Items Sold" value={totalItems} />
        <StatCard label="Revenue" value={`₱${totalRevenue.toFixed(2)}`} />
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
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
          <tbody>
            {sortedOrders.map((o, index) => (
              <tr key={o.id} className="border-t">
                <td className="p-3 font-medium">{index + 1}</td>
                <td className="p-3">#{o.id}</td>
                <td className="p-3">{new Date(o.createdAt).toLocaleString()}</td>
                <td className="p-3">{o.cashier?.fullName}</td>
                <td className="p-3 text-right">{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                <td className="p-3 text-right">₱{o.total.toFixed(2)}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${o.status === 'voided' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="p-3 space-x-2">
                  <button onClick={() => setViewing(o)} className="text-xs text-blue-600">View</button>
                  {o.status === 'complete' && (
                    <button onClick={() => setVoiding(o)} className="text-xs text-red-600">Void</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-2">
            <div className="flex justify-between"><h3 className="font-bold">Order #{viewing.id}</h3><button onClick={() => setViewing(null)}>�</button></div>
            <p className="text-xs text-gray-500">{new Date(viewing.createdAt).toLocaleString()} � Cashier: {viewing.cashier?.fullName}</p>
            <div className="border-t pt-2 space-y-1 text-sm">
              {viewing.items.map((i) => (
                <div key={i.productId} className="flex justify-between">
                  <span>{i.product.name} · {i.quantity} x ₱{i.unitPrice}</span>
                  <span>₱{i.lineTotal.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-2 flex justify-between font-bold"><span>Total</span><span className="text-green-700">₱{viewing.total.toFixed(2)}</span></div>
            {viewing.voidReason && <p className="text-xs text-red-600">Voided: {viewing.voidReason}</p>}
          </div>
        </div>
      )}

      {voiding && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleVoid} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between"><h3 className="font-bold">Void Order #{voiding.id}</h3><button type="button" onClick={() => setVoiding(null)}>×</button></div>
            <p className="text-xs text-gray-500">Total: ₱{voiding.total.toFixed(2)} · This will restore stock for all items.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div>
              <label className="text-sm font-medium">Reason for Void</label>
              <input required value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border rounded-md px-3 py-2 mt-1" placeholder="e.g. Wrong item scanned" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setVoiding(null)} className="border rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="bg-red-600 text-white rounded-md px-4 py-2 text-sm">Void Order</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return <div className="bg-white rounded-xl shadow p-4"><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold">{value}</p></div>;
}
