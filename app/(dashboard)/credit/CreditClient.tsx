'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/client/offline';
import { getUtangEntries } from '@/lib/client/api/inventory';
import { useRealtime } from '@/lib/client/hooks/use-realtime';
import { RECONNECT_EVENT_NAME } from '@/lib/client/hooks/useOfflineSync';
import { CachedDataBanner } from '@/components/CachedDataBanner';
import { Wallet, Users, TrendingUp, FileText } from 'lucide-react';

interface UtangItem {
  id: number;
  productId: number;
  product: { name: string };
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface PaymentAllocation {
  id: number;
  paymentId: number;
  utangEntryId: number;
  amountApplied: number;
  createdAt: string;
  payment: { id: number; amount: number; note?: string | null; createdAt: string };
}

interface UtangEntry {
  id: number;
  clientUuid?: string | null;
  customerId: number;
  customer: { id: number; name: string };
  totalAmount: number;
  amountPaid: number;
  remainingBalance: number;
  note?: string | null;
  status: string;
  createdAt: string;
  items: UtangItem[];
  paymentAllocations: PaymentAllocation[];
}

interface Activity {
  id: string;
  type: 'sale' | 'payment';
  customerId: number;
  customerName: string;
  amount: number;
  date: string;
  status?: string;
  entryId?: number;
  items?: UtangItem[];
  note?: string | null;
}

export default function CreditClient() {
  const liveUtang = useLiveQuery(() => db.utang.toArray());
  const [fallbackEntries, setEntries] = useState<UtangEntry[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all');
  const [isCached, setIsCached] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: UtangEntry[] = (liveUtang ?? []) as any;

  const refresh = useCallback(async () => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    if (offlineNow) return;
    try {
      const data = await getUtangEntries<UtangEntry>();
      await db.utang.bulkPut(data as unknown as Record<string, unknown>[]);
      setIsCached(false);
    } catch {
      setIsCached(true);
    }
  }, []);

  useRealtime({ utang: refresh });

  useEffect(() => {
    refresh();
    function handleReconnect() { refresh(); }
    window.addEventListener(RECONNECT_EVENT_NAME, handleReconnect);
    return () => window.removeEventListener(RECONNECT_EVENT_NAME, handleReconnect);
  }, [refresh]);

  const customerSummaries = useMemo(() => {
    const map = new Map<number, { id: number; name: string; totalOutstanding: number; entryCount: number; lastActivity: string }>();
    for (const e of entries) {
      if (e.status === 'paid') continue;
      const existing = map.get(e.customerId);
      if (existing) {
        existing.totalOutstanding += e.remainingBalance;
        existing.entryCount += 1;
        if (e.createdAt > existing.lastActivity) existing.lastActivity = e.createdAt;
      } else {
        map.set(e.customerId, {
          id: e.customerId,
          name: e.customer?.name ?? 'Unknown',
          totalOutstanding: e.remainingBalance,
          entryCount: 1,
          lastActivity: e.createdAt,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }, [entries]);

  const filteredCustomers = useMemo(() => {
    if (statusFilter === 'all') return customerSummaries;
    return customerSummaries.filter((c) => {
      const customerEntries = entries.filter((e) => e.customerId === c.id && e.status === statusFilter);
      return customerEntries.length > 0;
    });
  }, [customerSummaries, entries, statusFilter]);

  const activity = useMemo<Activity[]>(() => {
    const feed: Activity[] = [];
    for (const e of entries) {
      if (selectedCustomer && e.customerId !== selectedCustomer) continue;
      feed.push({
        id: `sale-${e.id}`,
        type: 'sale',
        customerId: e.customerId,
        customerName: e.customer?.name ?? 'Unknown',
        amount: e.totalAmount,
        date: e.createdAt,
        status: e.status,
        entryId: e.id,
        items: e.items,
        note: e.note,
      });
      for (const alloc of e.paymentAllocations ?? []) {
        if (selectedCustomer && e.customerId !== selectedCustomer) continue;
        feed.push({
          id: `payment-${alloc.id}`,
          type: 'payment',
          customerId: e.customerId,
          customerName: e.customer?.name ?? 'Unknown',
          amount: alloc.amountApplied,
          date: alloc.payment?.createdAt ?? alloc.createdAt,
          entryId: e.id,
          note: alloc.payment?.note,
        });
      }
    }
    return feed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [entries, selectedCustomer]);

  const totalOutstanding = useMemo(
    () => entries.filter((e) => e.status !== 'paid').reduce((s, e) => s + e.remainingBalance, 0),
    [entries]
  );
  const customersWithDebt = customerSummaries.length;
  const activeEntries = entries.filter((e) => e.status !== 'paid').length;
  const now = new Date();
  const collectedThisMonth = useMemo(() => {
    return entries.reduce((sum, e) => {
      return sum + (e.paymentAllocations ?? [])
        .filter((a) => {
          const d = new Date(a.payment?.createdAt ?? a.createdAt);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((s, a) => s + a.amountApplied, 0);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  return (
    <div className="space-y-4">
      <CachedDataBanner isOffline={isOffline} isCached={isCached} onRefresh={refresh} />

      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Credit Management</h1>
            <p className="text-sm text-slate-400">Customers, balances, and credit activity</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Outstanding"
          value={`₱${totalOutstanding.toFixed(2)}`}
          accent="text-amber-400"
          icon={<Wallet size={20} className="text-amber-400" />}
        />
        <StatCard
          label="Customers with Debt"
          value={customersWithDebt}
          accent="text-sky-400"
          icon={<Users size={20} className="text-sky-400" />}
        />
        <StatCard
          label="Collected This Month"
          value={`₱${collectedThisMonth.toFixed(2)}`}
          accent="text-emerald-400"
          icon={<TrendingUp size={20} className="text-emerald-400" />}
        />
        <StatCard
          label="Active Entries"
          value={activeEntries}
          accent="text-rose-400"
          icon={<FileText size={20} className="text-rose-400" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-white">Customers</h2>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-300 outline-none"
              >
                <option value="all">All</option>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
            </div>

            <button
              onClick={() => setSelectedCustomer(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 transition cursor-pointer ${
                selectedCustomer === null
                  ? 'bg-amber-600/20 border border-amber-500/30 text-amber-300'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              All Customers ({customerSummaries.length})
            </button>

            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {filteredCustomers.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">No customers found</p>
              ) : (
                filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCustomer(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition cursor-pointer ${
                      selectedCustomer === c.id
                        ? 'bg-amber-600/20 border border-amber-500/30 text-amber-300'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium truncate">{c.name}</span>
                      <span className="text-amber-400 font-bold">₱{c.totalOutstanding.toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800">
              <h2 className="font-bold text-white">Recent Activity</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedCustomer
                  ? `Showing activity for ${customerSummaries.find((c) => c.id === selectedCustomer)?.name ?? 'customer'}`
                  : 'All credit sales and payments'}
              </p>
            </div>

            {activity.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <p className="text-sm">No activity found</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800 max-h-[600px] overflow-y-auto">
                {activity.map((a) => (
                  <div key={a.id} className="px-4 py-3 hover:bg-slate-900/50 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          a.type === 'sale' ? 'bg-amber-500/15' : 'bg-emerald-500/15'
                        }`}>
                          {a.type === 'sale' ? (
                            <FileText size={14} className="text-amber-400" />
                          ) : (
                            <TrendingUp size={14} className="text-emerald-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                              a.type === 'sale' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
                            }`}>
                              {a.type === 'sale' ? 'Credit Sale' : 'Payment'}
                            </span>
                            {a.status && a.type === 'sale' && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                a.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300' :
                                a.status === 'partial' ? 'bg-sky-500/15 text-sky-300' :
                                'bg-rose-500/15 text-rose-300'
                              }`}>
                                {a.status}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-200 mt-1">
                            <span className="font-medium">{a.customerName}</span>
                            {a.type === 'sale' ? ' purchased items' : ' made a payment'}
                          </p>
                          {a.items && a.items.length > 0 && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {a.items.map((i) => `${i.product.name} ×${i.quantity}`).join(', ')}
                            </p>
                          )}
                          {a.note && (
                            <p className="text-xs text-slate-500 mt-0.5 italic">"{a.note}"</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-bold ${a.type === 'sale' ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {a.type === 'sale' ? '+' : '-'}₱{a.amount.toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {new Date(a.date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, icon }: { label: string; value: string | number; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{label}</p>
        {icon}
      </div>
      <p className={`text-xl font-bold mt-2 ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}
