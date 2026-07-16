'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

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
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const role = session?.user?.role ?? 'cashier';
  const nav = role === 'admin' ? ADMIN_NAV : CASHIER_NAV;

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen sticky top-0">
      <div className="p-4 flex items-center gap-2 border-b border-slate-800">
        <div className="w-9 h-9 bg-cyan-500 rounded-lg flex items-center justify-center text-slate-950">
          🏪
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
          <div className="text-sm font-semibold text-slate-100">{session?.user?.name ?? '...'}</div>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {role.toUpperCase()}
            </span>
            {role === 'admin' ? (
              <span
                className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}
              >
                <span className={`mr-2 h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-700' : 'bg-rose-700'}`} />
                {online ? 'Online' : 'Offline'}
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
    </aside>
  );
}
