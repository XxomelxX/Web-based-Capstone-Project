'use client';

import { useEffect, useState } from 'react';
import { getItemLog } from '@/lib/api/inventory';

interface ItemLogEntry {
  id: number; createdAt: string; action: string; quantity: number;
  product: { name: string }; user: { fullName: string };
}

const ACTION_COLORS: Record<string, string> = {
  sold: 'bg-blue-100 text-blue-700',
  restocked: 'bg-green-100 text-green-700',
  voided: 'bg-red-100 text-red-700',
  adjusted: 'bg-yellow-100 text-yellow-800',
};

export default function ItemLogPage() {
  const [logs, setLogs] = useState<ItemLogEntry[]>([]);

  useEffect(() => {
    getItemLog().then(setLogs);
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Item Log</h1>
        <p className="text-sm text-gray-500">Every stock movement — sales, restocks, and voids — logged automatically.</p>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="p-3">Date</th><th className="p-3">Product</th><th className="p-3">Action</th><th className="p-3">Quantity</th><th className="p-3">Performed By</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-3">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="p-3">{l.product?.name}</td>
                <td className="p-3"><span className={`text-xs px-2 py-1 rounded-full capitalize ${ACTION_COLORS[l.action] ?? 'bg-gray-100'}`}>{l.action}</span></td>
                <td className="p-3">{l.quantity}</td>
                <td className="p-3">{l.user?.fullName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
