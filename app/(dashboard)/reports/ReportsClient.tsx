'use client';

import { useEffect, useState } from 'react';
import { getReports } from '@/lib/api/inventory';
import { useRealtime } from '@/lib/use-realtime';
import { ShiftDetails } from '@/lib/api/shift';

interface ShiftHistoryItem extends ShiftDetails {
  verificationStatus?: 'verified' | 'flagged' | null;
}

interface ReportData {
  totalRevenue: number;
  totalTransactions: number;
  totalItemsSold: number;
  estimatedProfit: number;
  topSelling: Array<{ name: string; unitsSold: number; revenue: number }>;
  stockLevels: Array<{ name: string; stock: number; status: string }>;
}

export default function ReportsClient() {
  const [range, setRange] = useState<'week' | 'month' | 'all'>('all');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadReports(selectedRange: 'week' | 'month' | 'all') {
    setLoading(true);
    setError('');

    try {
      const reportData = await getReports<ReportData>(selectedRange);
      setData(reportData);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      setError(err instanceof Error ? err.message : 'Unable to load reports');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useRealtime({
    transactions: () => void loadReports(range),
    expenses: () => void loadReports(range),
    restock: () => void loadReports(range),
    products: () => void loadReports(range),
    utang: () => void loadReports(range),
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReports(range);
  }, [range]);

  const lowStockCount = data?.stockLevels.filter((s) => s.status === 'Critical').length ?? 0;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Analytics</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Reports</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              View sales performance, stock health, and the best-selling products across your store.
            </p>
          </div>

          <div className="inline-flex items-center gap-3 rounded-3xl border border-slate-800/80 bg-slate-900/95 px-4 py-3 text-sm text-slate-200 shadow-lg shadow-black/10">
            <span className="text-slate-400">Report range</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as 'week' | 'month' | 'all')}
              className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400"
            >
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-8 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
          <p className="text-slate-400">Loading report details…</p>
        </div>
      ) : error ? (
        <div className="rounded-[2rem] border border-rose-500/20 bg-rose-500/5 p-6 text-rose-100 shadow-[0_24px_80px_-46px_rgba(139,0,0,0.45)]">
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={() => loadReports(range)}
            className="mt-4 inline-flex items-center rounded-3xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-8 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
          <p className="text-slate-400">No report data available.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardStatCard label="Revenue" value={`₱${data.totalRevenue.toFixed(2)}`} accent="text-emerald-300" />
            <DashboardStatCard label="Transactions" value={String(data.totalTransactions)} accent="text-cyan-300" />
            <DashboardStatCard label="Items Sold" value={String(data.totalItemsSold)} accent="text-violet-300" />
            <DashboardStatCard label="Low Stock Alerts" value={String(lowStockCount)} accent={lowStockCount > 0 ? 'text-rose-400' : 'text-slate-300'} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Top Selling Products</h2>
                  <p className="text-sm text-slate-500">Performance by units sold and revenue.</p>
                </div>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-200">
                  Top 5
                </span>
              </div>

              {data.topSelling.length === 0 ? (
                <p className="text-sm text-slate-400">No sales data available yet.</p>
              ) : (
                <ol className="space-y-4">
                  {data.topSelling.map((product, index) => (
                    <li key={product.name} className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm text-slate-400">{index + 1}. {product.name}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.unitsSold} units sold</p>
                        </div>
                        <p className="text-sm font-semibold text-slate-200">₱{product.revenue.toFixed(2)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Stock Levels</h2>
                  <p className="text-sm text-slate-500">Monitor inventory health across items.</p>
                </div>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                  {data.stockLevels.length} items
                </span>
              </div>

              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                {data.stockLevels.map((stock) => (
                  <div key={stock.name} className="grid grid-cols-[1fr_auto_auto] gap-4 rounded-3xl border border-slate-800/80 bg-slate-900/80 px-4 py-4 text-sm text-slate-200">
                    <span className="font-medium text-slate-100">{stock.name}</span>
                    <span className="text-slate-400">{stock.stock}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stock.status === 'Critical' ? 'bg-rose-500/15 text-rose-300' : 'bg-slate-700/80 text-slate-300'}`}>
                      {stock.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live Register Spot-Check (X-Read Monitoring) */}
          <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <span>📡</span> Live Register Spot-Check (X-Read Monitoring)
                </h2>
                <p className="text-sm text-slate-500">Monitor active cashier open shifts and live cash drawer balances in real time without closing register shifts.</p>
              </div>
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300 animate-pulse">
                Live Snapshots
              </span>
            </div>

            <ActiveSpotCheckSection />
          </div>

          {/* Shift & Cash Drawer Audit Log (Z-Read History) */}
          <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <span>💼</span> Shift & Cash Drawer Audit Log (Z-Read History)
                </h2>
                <p className="text-sm text-slate-500">Track cashier register opening floats, cash sales, end-of-shift reconciliation, and cash overage/shortage variance.</p>
              </div>
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                Audited Logs
              </span>
            </div>

            <ShiftHistoryTable />
          </div>
        </>
      )}
    </div>
  );
}

interface ActiveShiftItem {
  id: number;
  cashier: { fullName: string; username: string };
  openingFloat: number;
  cashSales: number;
  gcashSales: number;
  totalSales: number;
  expectedCash: number;
  openedAt: string;
  transactionCount: number;
}

function ActiveSpotCheckSection() {
  const [activeShifts, setActiveShifts] = useState<ActiveShiftItem[]>([]);
  const [loading, setLoading] = useState(true);

  function loadSpotCheck() {
    setLoading(true);
    fetch('/api/shift/active-shifts')
      .then((res) => res.json())
      .then((data) => {
        setActiveShifts(data.activeShifts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    void Promise.resolve().then(loadSpotCheck);
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-400 py-4">Checking active register drawers...</p>;
  }

  if (activeShifts.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-slate-400 text-sm">
        No registers are currently open. Cashiers open shifts when processing sales.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {activeShifts.map((s) => (
        <div key={s.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <div>
              <div className="font-bold text-slate-100 text-sm">{s.cashier.fullName}</div>
              <div className="text-[11px] text-slate-400">@{s.cashier.username}</div>
            </div>
            <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Shift Active
            </span>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-400"><span>Opened At</span><span className="text-slate-200">{new Date(s.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
            <div className="flex justify-between text-slate-400"><span>Starting Float</span><span className="text-slate-200">₱{s.openingFloat.toFixed(2)}</span></div>
            <div className="flex justify-between text-slate-400"><span>Cash Sales (+)</span><span className="text-emerald-400">+₱{s.cashSales.toFixed(2)}</span></div>
            <div className="flex justify-between text-slate-400"><span>GCash Sales</span><span className="text-sky-400">₱{s.gcashSales.toFixed(2)}</span></div>
            <div className="flex justify-between text-slate-400"><span>Transactions</span><span className="text-slate-200">{s.transactionCount}</span></div>
            <hr className="border-slate-800 my-1" />
            <div className="flex justify-between font-bold text-sm text-slate-100"><span>Live Expected Cash</span><span className="text-cyan-400">₱{s.expectedCash.toFixed(2)}</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShiftHistoryTable() {
  const [shifts, setShifts] = useState<ShiftHistoryItem[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [verifyingShift, setVerifyingShift] = useState<ShiftHistoryItem | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<'verified' | 'flagged'>('verified');
  const [auditNotes, setAuditNotes] = useState('');
  const [submittingAudit, setSubmittingAudit] = useState(false);

  function loadHistory() {
    import('@/lib/api/shift').then(({ fetchShiftHistory }) => {
      fetchShiftHistory().then((data) => {
        setShifts(data);
        setLoadingShifts(false);
      });
    });
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!verifyingShift) return;
    setSubmittingAudit(true);
    try {
      const res = await fetch('/api/shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          shiftId: verifyingShift.id,
          verificationStatus: verifyStatus,
          verificationNotes: auditNotes,
        }),
      });
      if (res.ok) {
        setVerifyingShift(null);
        setAuditNotes('');
        loadHistory();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAudit(false);
    }
  }

  if (loadingShifts) {
    return <p className="text-sm text-slate-400 py-4">Loading shift reconciliation logs...</p>;
  }

  if (shifts.length === 0) {
    return <p className="text-sm text-slate-400 py-4">No shift reconciliation logs available yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300 border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-xs font-semibold uppercase text-slate-400">
              <th className="pb-3 px-2">Cashier</th>
              <th className="pb-3 px-2">Opened At</th>
              <th className="pb-3 px-2">Closed At</th>
              <th className="pb-3 px-2">Opening Float</th>
              <th className="pb-3 px-2">Cash Sales</th>
              <th className="pb-3 px-2">Expected Cash</th>
              <th className="pb-3 px-2">Counted Cash</th>
              <th className="pb-3 px-2">Variance</th>
              <th className="pb-3 px-2">Shift Status</th>
              <th className="pb-3 px-2">Auditor Sign-off</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {shifts.map((s) => {
              const isOverage = (s.overageShortage ?? 0) > 0;
              const isBalanced = (s.overageShortage ?? 0) === 0;

              return (
                <tr key={s.id} className="hover:bg-slate-900/50 transition">
                  <td className="py-3 px-2 font-medium text-slate-100">{s.cashier?.fullName || s.cashier?.username || `User #${s.cashierId}`}</td>
                  <td className="py-3 px-2 text-xs text-slate-400">{new Date(s.openedAt).toLocaleString()}</td>
                  <td className="py-3 px-2 text-xs text-slate-400">{s.closedAt ? new Date(s.closedAt).toLocaleString() : '—'}</td>
                  <td className="py-3 px-2 font-mono">₱{s.openingFloat.toFixed(2)}</td>
                  <td className="py-3 px-2 font-mono text-emerald-400">₱{(s.cashSales ?? 0).toFixed(2)}</td>
                  <td className="py-3 px-2 font-mono text-cyan-300">₱{(s.expectedCash ?? s.openingFloat).toFixed(2)}</td>
                  <td className="py-3 px-2 font-mono">{s.closingCash !== null ? `₱${s.closingCash.toFixed(2)}` : '—'}</td>
                  <td className="py-3 px-2 font-mono font-bold">
                    {s.overageShortage === null ? (
                      <span className="text-slate-500">—</span>
                    ) : isBalanced ? (
                      <span className="text-emerald-400">₱0.00</span>
                    ) : isOverage ? (
                      <span className="text-sky-400">+₱{s.overageShortage.toFixed(2)}</span>
                    ) : (
                      <span className="text-rose-400">-₱{Math.abs(s.overageShortage).toFixed(2)}</span>
                    )}
                  </td>
                  <td className="py-3 px-2">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      s.status === 'open' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="py-3 px-2">
                    {s.status === 'closed' ? (
                      s.verificationStatus === 'verified' ? (
                        <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded-md">
                          ✓ Verified
                        </span>
                      ) : s.verificationStatus === 'flagged' ? (
                        <span className="text-xs font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-1 rounded-md">
                          ⚠️ Flagged
                        </span>
                      ) : (
                        <button
                          onClick={() => setVerifyingShift(s)}
                          className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold px-2.5 py-1 rounded-md transition"
                        >
                          Sign-off / Audit
                        </button>
                      )
                    ) : (
                      <span className="text-slate-500 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Auditor Sign-off Modal */}
      {verifyingShift && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <form onSubmit={handleVerifySubmit} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                <span>🛡️</span> Auditor Shift Sign-off
              </h3>
              <button type="button" onClick={() => setVerifyingShift(null)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <div className="text-xs text-slate-300 space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div><strong className="text-slate-400">Cashier:</strong> {verifyingShift.cashier?.fullName}</div>
              <div><strong className="text-slate-400">Opening Float:</strong> ₱{verifyingShift.openingFloat?.toFixed(2)}</div>
              <div><strong className="text-slate-400">Expected Cash:</strong> ₱{verifyingShift.expectedCash?.toFixed(2)}</div>
              <div><strong className="text-slate-400">Counted Cash:</strong> ₱{verifyingShift.closingCash?.toFixed(2)}</div>
              <div><strong className="text-slate-400">Variance:</strong> {verifyingShift.overageShortage === null ? '—' : verifyingShift.overageShortage >= 0 ? `+₱${verifyingShift.overageShortage.toFixed(2)}` : `-₱${Math.abs(verifyingShift.overageShortage).toFixed(2)}`}</div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Sign-off Decision</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVerifyStatus('verified')}
                  className={`py-2 rounded-xl text-xs font-bold border transition ${
                    verifyStatus === 'verified' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-950 text-slate-400 border-slate-800'
                  }`}
                >
                  ✓ Verify (Safe Deposit Matches)
                </button>
                <button
                  type="button"
                  onClick={() => setVerifyStatus('flagged')}
                  className={`py-2 rounded-xl text-xs font-bold border transition ${
                    verifyStatus === 'flagged' ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-950 text-slate-400 border-slate-800'
                  }`}
                >
                  ⚠️ Flag (Discrepancy)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Auditor Notes</label>
              <input
                type="text"
                value={auditNotes}
                onChange={(e) => setAuditNotes(e.target.value)}
                placeholder="Physical cash verified in store safe / Discrepancy logged"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setVerifyingShift(null)}
                className="flex-1 border border-slate-700 rounded-xl py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingAudit}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl py-2 text-xs font-semibold transition"
              >
                {submittingAudit ? 'Submitting...' : 'Submit Sign-off'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function DashboardStatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-5 shadow-[0_24px_80px_-46px_rgba(0,0,0,0.85)]">
      <p className="text-sm uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-4 text-3xl font-semibold ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}

