'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useOfflineSync } from '@/lib/useOfflineSync';
import Image from 'next/image';

const ADMIN_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pos', label: 'POS' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/lowstock', label: 'Low Stock' },
  { href: '/orders', label: 'Orders' },
  { href: '/utang', label: 'Utang / Credit' },
  { href: '/transaction-log', label: 'Transaction Log' },
  { href: '/item-log', label: 'Item Log' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/reports', label: 'Reports' },
  { href: '/users', label: 'Users' },
  { href: '/settings', label: 'Settings' },
];

const CASHIER_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pos', label: 'POS' },
  { href: '/lowstock', label: 'Low Stock' },
  { href: '/orders', label: 'Orders' },
  { href: '/utang', label: 'Utang / Credit' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { online, queuedCount, failedCount, syncing } = useOfflineSync();

  const role = mounted && session?.user?.role ? session.user.role : 'cashier';
  const displayName = mounted ? session?.user?.name ?? '...' : '...';
  const activeNav = role === 'admin' ? ADMIN_NAV : CASHIER_NAV;

  const userDisplayName = displayName;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMounted(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const nav = mounted ? activeNav : CASHIER_NAV;

  return (
    <>
      <div className="lg:hidden bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 bg-cyan-500 rounded-lg flex items-center justify-center">
            <Image src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg" alt="Sari-Sari POS" width={36} height={36} className="rounded-lg object-cover" />
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

      <aside className="hidden lg:flex flex-col w-64 bg-slate-900 border-r border-slate-800 h-screen sticky top-0">
        <div className="p-4 flex items-center gap-2 border-b border-slate-800">
          <div className="w-9 h-9 bg-cyan-500 rounded-lg flex items-center justify-center">
            <Image src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg" alt="Sari-Sari POS" width={36} height={36} className="rounded-lg object-cover" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight text-slate-100">Sari-Sari POS</div>
            <div className="text-xs text-slate-400">Inventory &amp; Sales</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-4 py-2 mx-2 rounded-md text-sm font-medium ${
                  active ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {item.label}
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
              {mounted ? (
                <>
                  <span
                    className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${syncing ? 'bg-sky-100 text-sky-800' : online ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}
                  >
                    <span className={`mr-2 h-2.5 w-2.5 rounded-full ${syncing ? 'bg-sky-700' : online ? 'bg-emerald-700' : 'bg-rose-700'}`} />
                    {syncing ? 'Syncing...' : online ? `Online (${queuedCount} queued)` : `Offline (${queuedCount} queued)`}
                  </span>
                  {failedCount > 0 ? (
                    <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
                      {failedCount} failed
                    </span>
                  ) : null}
                </>
              ) : (
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
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50">
          <div className="absolute left-0 top-0 h-full w-72 bg-slate-900 border-r border-slate-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 bg-cyan-500 rounded-lg flex items-center justify-center">
                  <Image src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg" alt="Sari-Sari POS" width={36} height={36} className="rounded-lg object-cover" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm leading-tight text-slate-100 truncate">Sari-Sari POS</div>
                  <div className="text-[10px] text-slate-400 truncate">{role.toUpperCase()}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-2">
              {nav.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block px-4 py-2 rounded-md text-sm font-medium ${
                      active ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {item.label}
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
                  {role === 'admin' ? (
                    <span
                      className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${syncing ? 'bg-sky-100 text-sky-800' : online ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}
                    >
                      <span className={`mr-2 h-2.5 w-2.5 rounded-full ${syncing ? 'bg-sky-700' : online ? 'bg-emerald-700' : 'bg-rose-700'}`} />
                      {syncing ? 'Syncing...' : online ? `Online (${queuedCount} queued)` : `Offline (${queuedCount} queued)`}
                    </span>
                  ) : null}
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
    </>
  );
}
