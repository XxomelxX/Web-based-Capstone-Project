'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useOfflineSync } from '@/lib/useOfflineSync';
import type { QueuedCategory1Action } from '@/lib/offlineQueue';
import { ShiftDetails, fetchActiveShift } from '@/lib/api/shift';
import Image from 'next/image';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  LayoutGrid,
  AlertTriangle,
  ClipboardList,
  Wallet,
  FileClock,
  ListOrdered,
  Receipt,
  BarChart3,
  Users,
  Settings,
} from 'lucide-react';

const ADMIN_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pos', label: 'POS', icon: ShoppingCart },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/categories', label: 'Categories', icon: LayoutGrid },
  { href: '/lowstock', label: 'Low Stock', icon: AlertTriangle },
  { href: '/orders', label: 'Orders', icon: ClipboardList },
  { href: '/utang', label: 'Utang / Credit', icon: Wallet },
  { href: '/transaction-log', label: 'Transaction Log', icon: FileClock },
  { href: '/item-log', label: 'Item Log', icon: ListOrdered },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const CASHIER_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pos', label: 'POS', icon: ShoppingCart },
  { href: '/lowstock', label: 'Low Stock', icon: AlertTriangle },
  { href: '/orders', label: 'Orders', icon: ClipboardList },
  { href: '/utang', label: 'Utang / Credit', icon: Wallet },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeShift, setActiveShift] = useState<ShiftDetails | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [queuedItems, setQueuedItems] = useState<QueuedCategory1Action[]>([]);
  const { online, queuedCount, failedCount, syncing, syncQueue } = useOfflineSync();

  const role = mounted && session?.user?.role ? session.user.role : 'cashier';
  const displayName = mounted ? session?.user?.name ?? '...' : '...';
  const activeNav = role === 'admin' ? ADMIN_NAV : CASHIER_NAV;

  const userDisplayName = displayName;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMounted(true);
    fetchActiveShift().then(setActiveShift);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const nav = mounted ? activeNav : CASHIER_NAV;

  const openModal = async () => {
    setShowSyncModal(true);
    const { getAllQueuedCategory1Actions } = await import('@/lib/offlineQueue');
    const actions = await getAllQueuedCategory1Actions();
    setQueuedItems(actions);
  };

  const statusPill = (
    <button
      type="button"
      onClick={openModal}
      className="hover:opacity-80 transition cursor-pointer text-left"
    >
      <span
        className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${
          syncing
            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
            : online && queuedCount === 0
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
        }`}
      >
        <span
          className={`mr-1.5 h-2 w-2 rounded-full ${
            syncing
              ? 'bg-sky-400 animate-pulse'
              : online && queuedCount === 0
              ? 'bg-emerald-400'
              : 'bg-amber-400'
          }`}
        />
        {syncing
          ? '🔵 Syncing...'
          : online && queuedCount === 0
          ? '🟢 Online'
          : online
          ? `🟢 Online (${queuedCount} queued)`
          : `🟡 Offline (${queuedCount} queued)`}
      </span>
      {failedCount > 0 ? (
        <span className="ml-1 inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40">
          ⚠️ {failedCount} failed
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      <div className="lg:hidden bg-slate-950/65 backdrop-blur-md border-b border-slate-800/50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-24 h-16 flex items-center justify-center overflow-hidden rounded-lg bg-black">
            <Image src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg" alt="Sari-Sari POS" width={96} height={64} className="object-contain" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm leading-tight text-slate-100 truncate">Sari-Sari POS</div>
            <div className="text-[10px] text-slate-400 truncate">{role.toUpperCase()}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      <aside className="hidden lg:flex flex-col w-64 bg-slate-950/65 backdrop-blur-xl border-r border-slate-800/50 h-screen sticky top-0">
        <div className="p-4 flex flex-col items-center text-center gap-3 border-b border-slate-800">
          <div className="w-52 h-32 flex items-center justify-center overflow-hidden rounded-xl bg-black">
            <Image src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg" alt="Sari-Sari POS" width={208} height={128} className="object-contain" />
          </div>
          <div className="w-full">
            <div className="font-bold text-base leading-tight text-slate-100 truncate">Sari-Sari POS</div>
            <div className="text-xs text-slate-400 truncate">Inventory &amp; Sales</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {nav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2 mx-2 rounded-md text-sm font-medium ${
                  active ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {Icon ? <Icon size={18} /> : null}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 space-y-2">
          <div>
            <div className="text-sm font-semibold text-slate-100">{userDisplayName}</div>
            <div className="flex flex-wrap gap-2 mt-1">
              <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                {role.toUpperCase()}
              </span>
              {activeShift && (
                <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/50">
                  <span className="mr-1 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Shift Open
                </span>
              )}
              {mounted ? statusPill : (
                <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-500">
                  <span className="mr-2 h-2.5 w-2.5 rounded-full bg-slate-500" />
                  Loading
                </span>
              )}
            </div>
          </div>

          {!confirmLogout ? (
            <button
              onClick={() => setConfirmLogout(true)}
              className="w-full border border-slate-700 rounded-md py-2 text-sm text-rose-300 hover:bg-slate-800"
            >
              Logout
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">Are you sure you want to logout?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmLogout(false)}
                  className="flex-1 border border-slate-700 rounded-md py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex-1 bg-purple-600 text-white rounded-md py-1 text-xs"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm">
          <div className="absolute left-0 top-0 h-full w-72 bg-slate-950/80 backdrop-blur-xl border-r border-slate-800/50 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-32 h-20 flex items-center justify-center overflow-hidden rounded-xl bg-black shrink-0">
                  <Image src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg" alt="Sari-Sari POS" width={128} height={80} className="object-contain" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm leading-tight text-slate-100 truncate">Sari-Sari POS</div>
                  <div className="text-[10px] text-slate-400 truncate">{role.toUpperCase()}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 shrink-0"
              >
                Close
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-2">
              {nav.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium ${
                      active ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {Icon ? <Icon size={18} /> : null}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-slate-800 p-4 space-y-2">
              <div>
                <div className="text-sm font-semibold text-slate-100">{userDisplayName}</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {role.toUpperCase()}
                  </span>
                  {statusPill}
                </div>
              </div>

              {!confirmLogout ? (
                <button
                  onClick={() => setConfirmLogout(true)}
                  className="w-full border border-slate-700 rounded-md py-2 text-sm text-rose-300 hover:bg-slate-800"
                >
                  Logout
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">Are you sure you want to logout?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmLogout(false)}
                      className="flex-1 border border-slate-700 rounded-md py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => signOut({ callbackUrl: '/login' })}
                      className="flex-1 bg-purple-600 text-white rounded-md py-1 text-xs"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category 1 Sync Review Panel Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 font-sans text-slate-100">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <span>🔄</span> Category 1 Offline Queue &amp; Sync Review
              </h3>
              <button onClick={() => setShowSyncModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="text-xs text-slate-400 flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div>Status: <strong className={online ? 'text-emerald-400' : 'text-amber-400'}>{online ? '🟢 Connected' : '🟡 Offline Mode'}</strong></div>
              <div>Category 1 Queued: <strong className="text-cyan-300">{queuedCount}</strong></div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 text-xs">
              {queuedItems.length === 0 ? (
                <p className="text-slate-500 text-center py-6">No pending Category 1 offline actions in queue. All data synced!</p>
              ) : (
                queuedItems.map((item, idx) => {
                  const title =
                    item.type === 'pos_sale'
                      ? 'POS Complete Sale'
                      : item.type === 'add_utang'
                      ? 'Utang — Add Utang'
                      : 'Utang — Record Payment';

                  const detail =
                    item.type === 'pos_sale'
                      ? `Items: ${item.payload.items?.length || 0} · Method: ${item.payload.paymentMethod}`
                      : item.type === 'add_utang'
                      ? `Customer: ${item.payload.customerName} · Items: ${item.payload.items?.length || 0}`
                      : `Customer: ${item.payload.customerName} · Amount: ₱${item.payload.amount?.toFixed(2) || '0.00'}`;

                  return (
                    <div key={idx} className="bg-slate-950/80 border border-slate-800 p-3 rounded-xl space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-200">{title}</span>
                        <span className={item.syncFailed ? 'text-rose-400' : item.synced ? 'text-emerald-400' : 'text-amber-300'}>
                          {item.syncFailed ? '⚠️ Sync Failed (Admin Review)' : item.synced ? '✓ Synced' : '🟡 Pending Sync'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 flex justify-between">
                        <span>{detail}</span>
                        <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {item.errorMessage && (
                        <div className="text-[10px] text-rose-300 bg-rose-950/40 p-1.5 rounded border border-rose-800/40">
                          {item.errorMessage}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  await syncQueue();
                  const { getAllQueuedCategory1Actions } = await import('@/lib/offlineQueue');
                  setQueuedItems(await getAllQueuedCategory1Actions());
                }}
                disabled={!online || syncing}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl py-2 text-xs font-semibold transition disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : '🔄 Force Sync Queue Now'}
              </button>
              <button
                type="button"
                onClick={() => setShowSyncModal(false)}
                className="border border-slate-700 rounded-xl px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
