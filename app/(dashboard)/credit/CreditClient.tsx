'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getCachedUtangEntries } from '@/lib/client/offline';
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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeTime(v: unknown, fallback = ''): number {
  if (!v) return NaN;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// Debt-warning policy (tunable): an unpaid entry older than AGING_DAYS flags
// as aging (amber); older than OVERDUE_DAYS flags as overdue (red).
const AGING_DAYS = 7;
const OVERDUE_DAYS = 30;

function daysSince(iso: unknown): number | null {
  const t = safeTime(iso);
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return 0;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function isToday(iso: unknown): boolean {
  const t = safeTime(iso);
  if (Number.isNaN(t)) return false;
  const d = new Date(t);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

type DebtTier = 'ok' | 'aging' | 'overdue';

export default function CreditClient() {
  const liveUtang = useLiveQuery(() => db.utang.toArray());
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all');
  const [isCached, setIsCached] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: UtangEntry[] = useMemo(() => ((liveUtang ?? []) as any[]).filter((e) => e && typeof e === 'object' && e.id != null) as UtangEntry[], [liveUtang]);

  const refresh = useCallback(async () => {
    const offlineNow = typeof window !== 'undefined' && !navigator.onLine;
    setIsOffline(offlineNow);
    if (offlineNow) {
      try {
        const cached = await getCachedUtangEntries<UtangEntry>();
        setIsCached(!cached?.length ? true : false);
      } catch {
        setIsCached(true);
      }
      return;
    }
    try {
      const data = await getUtangEntries<UtangEntry>();
      const normalized = (Array.isArray(data) ? data : []).map((e) => {
        const entry = e as unknown as Record<string, unknown>;
        const items = Array.isArray(entry.items) ? (entry.items as Record<string, unknown>[]).map((i) => ({
          ...i,
          quantity: num(i.quantity),
          unitPrice: num(i.unitPrice),
          lineTotal: num(i.lineTotal),
          product: { name: (i.product as { name?: string } | null)?.name ?? 'Unknown' },
        })) : [];
        const paymentAllocations = Array.isArray(entry.paymentAllocations) ? (entry.paymentAllocations as Record<string, unknown>[]).map((a) => ({
          ...a,
          amountApplied: num(a.amountApplied),
        })) : [];
        return {
          ...entry,
          totalAmount: num(entry.totalAmount),
          amountPaid: num(entry.amountPaid),
          remainingBalance: num(entry.remainingBalance),
          items,
          paymentAllocations,
        } as unknown as Record<string, unknown>;
      });
      if (normalized.length > 0) {
        try {
          await db.utang.clear();
          await db.utang.bulkPut(normalized);
        } catch {
          // Cache write must never crash render; live data still renders.
        }
      }
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
      if (!e || e.status === 'paid') continue;
      const cid = num(e.customerId);
      if (!cid) continue;
      const bal = num(e.remainingBalance);
      const existing = map.get(cid);
      if (existing) {
        existing.totalOutstanding += bal;
        existing.entryCount += 1;
        if ((e.createdAt ?? '') > existing.lastActivity) existing.lastActivity = e.createdAt ?? '';
      } else {
        map.set(cid, {
          id: cid,
          name: e.customer?.name ?? 'Unknown',
          totalOutstanding: bal,
          entryCount: 1,
          lastActivity: e.createdAt ?? '',
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

  // Per-customer debt flags: warning tier from the oldest UNPAID entry age,
  // plus today's collected payments. Pure client-side — works offline.
  const debtFlags = useMemo(() => {
    const map = new Map<number, { tier: DebtTier; maxAgeDays: number; paidToday: number; paidTodayCount: number }>();
    for (const e of entries) {
      if (!e) continue;
      const cid = num(e.customerId);
      if (!cid) continue;
      let flag = map.get(cid);
      if (!flag) {
        flag = { tier: 'ok', maxAgeDays: 0, paidToday: 0, paidTodayCount: 0 };
        map.set(cid, flag);
      }
      if (e.status !== 'paid') {
        const age = daysSince(e.createdAt);
        if (age !== null && age > flag.maxAgeDays) flag.maxAgeDays = age;
      }
      for (const a of e.paymentAllocations ?? []) {
        if (!a) continue;
        const payDate = a.payment?.createdAt ?? a.createdAt;
        if (isToday(payDate)) {
          flag.paidToday += num(a.amountApplied);
          flag.paidTodayCount += 1;
        }
      }
    }
    for (const flag of map.values()) {
      if (flag.maxAgeDays > OVERDUE_DAYS) flag.tier = 'overdue';
      else if (flag.maxAgeDays > AGING_DAYS) flag.tier = 'aging';
    }
    return map;
  }, [entries]);

  const needsAttentionCount = useMemo(
    () => Array.from(debtFlags.values()).filter((f) => f.tier === 'overdue').length,
    [debtFlags]
  );
  const paidTodaySummary = useMemo(() => {
    let customers = 0;
    let total = 0;
    for (const f of debtFlags.values()) {
      if (f.paidToday > 0) {
        customers += 1;
        total += f.paidToday;
      }
    }
    return { customers, total };
  }, [debtFlags]);
  const overdueSummary = useMemo(() => {
    let customers = 0;
    let total = 0;
    for (const [cid, f] of debtFlags) {
      if (f.tier === 'overdue') {
        customers += 1;
        total += num(customerSummaries.find((c) => c.id === cid)?.totalOutstanding);
      }
    }
    return { customers, total };
  }, [debtFlags, customerSummaries]);

  const activity = useMemo<Activity[]>(() => {
    const feed: Activity[] = [];
    for (const e of entries) {
      if (!e || e.id == null) continue;
      if (selectedCustomer && num(e.customerId) !== selectedCustomer) continue;
      feed.push({
        id: `sale-${e.id}`,
        type: 'sale',
        customerId: num(e.customerId),
        customerName: e.customer?.name ?? 'Unknown',
        amount: num(e.totalAmount),
        date: e.createdAt ?? new Date().toISOString(),
        status: e.status ?? 'unpaid',
        entryId: num(e.id),
        items: Array.isArray(e.items) ? e.items : [],
        note: e.note ?? null,
      });
      for (const alloc of e.paymentAllocations ?? []) {
        if (!alloc) continue;
        if (selectedCustomer && num(e.customerId) !== selectedCustomer) continue;
        feed.push({
          id: `payment-${alloc.id ?? `${e.id}-${feed.length}`}`,
          type: 'payment',
          customerId: num(e.customerId),
          customerName: e.customer?.name ?? 'Unknown',
          amount: num(alloc.amountApplied),
          date: alloc.payment?.createdAt ?? alloc.createdAt ?? e.createdAt ?? new Date().toISOString(),
          entryId: num(e.id),
          note: alloc.payment?.note ?? null,
        });
      }
    }
    return feed.sort((a, b) => {
      const tb = safeTime(b.date);
      const ta = safeTime(a.date);
      if (Number.isNaN(tb) && Number.isNaN(ta)) return 0;
      if (Number.isNaN(tb)) return -1;
      if (Number.isNaN(ta)) return 1;
      return tb - ta;
    });
  }, [entries, selectedCustomer]);

  const totalOutstanding = useMemo(
    () => entries.filter((e) => e?.status !== 'paid').reduce((s, e) => s + num(e?.remainingBalance), 0),
    [entries]
  );
  const customersWithDebt = customerSummaries.length;
  const now = new Date();
  const collectedThisMonth = useMemo(() => {
    return entries.reduce((sum, e) => {
      return sum + (e?.paymentAllocations ?? [])
        .filter((a) => {
          const d = new Date(a?.payment?.createdAt ?? a?.createdAt ?? '');
          if (Number.isNaN(d.getTime())) return false;
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((s, a) => s + num(a?.amountApplied), 0);
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
          value={`₱${num(totalOutstanding).toFixed(2)}`}
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
          value={`₱${num(collectedThisMonth).toFixed(2)}`}
          accent="text-emerald-400"
          icon={<TrendingUp size={20} className="text-emerald-400" />}
        />
        <StatCard
          label="Needs Attention"
          value={needsAttentionCount}
          accent="text-rose-400"
          icon={<FileText size={20} className="text-rose-400" />}
        />
      </div>

      {paidTodaySummary.customers > 0 && (
        <div className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-md px-3 py-2">
          ✓ {paidTodaySummary.customers} {paidTodaySummary.customers === 1 ? 'customer' : 'customers'} paid today · ₱{num(paidTodaySummary.total).toFixed(2)} collected
        </div>
      )}
      {overdueSummary.customers > 0 && (
        <div className="text-sm text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-md px-3 py-2">
          ⚠️ {overdueSummary.customers} {overdueSummary.customers === 1 ? 'customer' : 'customers'} overdue (unpaid &gt; {OVERDUE_DAYS} days) · ₱{num(overdueSummary.total).toFixed(2)} at risk
        </div>
      )}

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
                filteredCustomers.map((c) => {
                  const flag = debtFlags.get(c.id);
                  const tier = flag?.tier ?? 'ok';
                  return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCustomer(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition cursor-pointer ${
                      tier === 'overdue' ? 'border-l-2 border-l-rose-500 ' : ''
                    }${
                      selectedCustomer === c.id
                        ? 'bg-amber-600/20 border border-amber-500/30 text-amber-300'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium truncate">{c.name}</span>
                      <span className="text-amber-400 font-bold">₱{num(c.totalOutstanding).toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}</span>
                      {tier === 'overdue' && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 font-semibold">⚠️ Overdue</span>
                      )}
                      {tier === 'aging' && flag && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-semibold">⚠️ {flag.maxAgeDays}d unpaid</span>
                      )}
                      {flag && flag.paidToday > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-semibold">✓ Paid today −₱{num(flag.paidToday).toFixed(2)}</span>
                      )}
                    </div>
                  </button>
                  );
                  }))}
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
                {activity.map((a) => {
                  const paidTodayRow = a.type === 'payment' && isToday(a.date);
                  const saleAge = a.type === 'sale' && a.status !== 'paid' ? daysSince(a.date) : null;
                  const staleSale = saleAge !== null && saleAge > OVERDUE_DAYS;
                  return (
                  <div
                    key={a.id}
                    className={`px-4 py-3 hover:bg-slate-900/50 transition ${
                      paidTodayRow ? 'bg-emerald-500/5 border-l-2 border-l-emerald-500' : ''
                    }`}
                  >
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
                            {staleSale && saleAge !== null && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-300 font-semibold">
                                ⚠️ {saleAge}d unpaid
                              </span>
                            )}
                            {paidTodayRow && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold">
                                ✓ Paid today
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-200 mt-1">
                            <span className="font-medium">{a.customerName}</span>
                            {a.type === 'sale' ? ' purchased items' : ' made a payment'}
                          </p>
                          {a.items && a.items.length > 0 && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {a.items.map((i) => `${i.product?.name ?? 'Item'} ×${num(i.quantity)}`).join(', ')}
                            </p>
                          )}
                          {a.note && (
                            <p className="text-xs text-slate-500 mt-0.5 italic">&quot;{a.note}&quot;</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-bold ${a.type === 'sale' ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {a.type === 'sale' ? '+' : '-'}₱{num(a.amount).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {(() => { const t = safeTime(a.date); return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString(); })()}
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })}
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
