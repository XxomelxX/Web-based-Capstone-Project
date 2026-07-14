'use client';

import { useEffect, useState } from 'react';
import { getTransactions } from '@/lib/api/inventory';

interface Transaction {
  id: number; createdAt: string; cashier: { fullName: string };
  paymentMethod: string; total: number; status: string;
}

export default function TransactionLogPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    getTransactions().then(setTransactions);
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Transaction Log</h1>
        <p className="text-sm text-gray-500">Full chronological audit of every sale — read-only.</p>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr><th className="p-3">Order#</th><th className="p-3">Date/Time</th><th className="p-3">Cashier</th><th className="p-3">Payment</th><th className="p-3">Total</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-3">#{t.id}</td>
                <td className="p-3">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="p-3">{t.cashier?.fullName}</td>
                <td className="p-3 capitalize">{t.paymentMethod}</td>
                <td className="p-3">₱{t.total.toFixed(2)}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${t.status === 'voided' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'}`}>{t.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
