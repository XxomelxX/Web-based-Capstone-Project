'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';

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

  const role = session?.user?.role ?? 'cashier';
  const nav = role === 'admin' ? ADMIN_NAV : CASHIER_NAV;

  return (
    <aside className="w-64 bg-[#faf6ef] border-r flex flex-col h-screen sticky top-0">
      <div className="p-4 flex items-center gap-2 border-b">
        <div className="w-9 h-9 bg-green-600 rounded-lg flex items-center justify-center text-white">
          🏪
        </div>
        <div>
          <div className="font-bold text-sm leading-tight">Sari-Sari POS</div>
          <div className="text-xs text-gray-500">Inventory &amp; Sales</div>
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
                active ? 'bg-green-700 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4 space-y-2">
        <div>
          <div className="text-sm font-semibold">{session?.user?.name ?? '...'}</div>
          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
            {role.toUpperCase()}
          </span>
        </div>

        {!confirmLogout ? (
          <button
            onClick={() => setConfirmLogout(true)}
            className="w-full border rounded-md py-2 text-sm text-red-600 hover:bg-red-50"
          >
            Logout
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-600">Are you sure you want to logout?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 border rounded-md py-1 text-xs"
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
