'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ChevronDown, LogOut, Sun, Moon } from 'lucide-react';
import Image from 'next/image';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useTheme } from '@/lib/useTheme';
import { OfflineStatusPill } from '@/components/OfflineStatusPill';
import { OfflineSyncModal } from '@/components/OfflineSyncModal';

const ADMIN_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pos', label: 'POS' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/orders', label: 'Orders' },
  { href: '/utang', label: 'Utang / Credit' },
];

const ADMIN_MORE = [
  { href: '/lowstock', label: 'Low Stock' },
  { href: '/transaction-log', label: 'Transaction Log' },
  { href: '/item-log', label: 'Item Log' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/reports', label: 'Reports' },
  { href: '/users', label: 'Users' },
  { href: '/settings', label: 'Settings' },
];

const CASHIER_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pos', label: 'POS' },
  { href: '/orders', label: 'Orders' },
  { href: '/utang', label: 'Utang / Credit' },
];

const CASHIER_MORE = [
  { href: '/lowstock', label: 'Low Stock' },
  { href: '/settings', label: 'Settings' },
];

export function TopNavbar() {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  const role = user?.role ?? 'cashier';
  const links = role === 'admin' ? ADMIN_LINKS : CASHIER_LINKS;
  const moreLinks = role === 'admin' ? ADMIN_MORE : CASHIER_MORE;

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('offlineSession');
    }
    signOut({ callbackUrl: '/login' });
  };

  return (
    <nav className="hidden md:flex items-center justify-between px-6 lg:px-8 py-3 border-b shadow-sm sticky top-0 z-40 bg-green-100">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 flex items-center justify-center overflow-hidden rounded-full bg-black shrink-0">
          <Image
            src="/1130f5ee-b20d-41b4-89c5-23c877b4d396.jpg"
            alt="Sari-Sari POS logo"
            width={36}
            height={36}
            className="object-contain"
          />
        </div>
        <span className="font-bold text-lg">J &amp; J Merchandise Store</span>
      </div>

      <div className="flex items-center gap-6 text-sm font-semibold">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname === link.href ? 'text-green-700' : 'hover:text-green-700 text-gray-600'}
          >
            {link.label}
          </Link>
        ))}

        <div className="relative" onMouseEnter={() => setMoreOpen(true)} onMouseLeave={() => setMoreOpen(false)}>
          <button className="flex items-center gap-1 hover:text-green-700 text-gray-600">
            More <ChevronDown size={16} />
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-full mt-2 shadow-lg rounded-md py-2 w-48 z-50">
              {moreLinks.map((link) => (
                <Link key={link.href} href={link.href} className="block px-4 py-2 text-sm hover:bg-gray-50">
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <OfflineStatusPill onClick={() => setShowSyncModal(true)} />

        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg border p-2 hover:bg-gray-100 transition"
          aria-label="Toggle light/dark mode"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2"
            aria-label="User menu"
          >
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-700">
              {user?.name?.[0] ?? '?'}
            </div>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                role === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'
              }`}
            >
              {role.toUpperCase()}
            </span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 shadow-lg rounded-md py-2 w-52 z-50">
              <div className="px-4 py-2 text-sm font-semibold border-b">{user?.name ?? 'Store User'}</div>
              <div className="px-4 py-1 text-xs text-gray-500">{user?.username}</div>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <LogOut size={14} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {showSyncModal && <OfflineSyncModal onClose={() => setShowSyncModal(false)} />}
    </nav>
  );
}
