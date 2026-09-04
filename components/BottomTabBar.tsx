'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ShoppingCart, ClipboardList, Wallet, Menu } from 'lucide-react';
import { useState } from 'react';
import { useCurrentUser } from '@/lib/useCurrentUser';

const TABS = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/pos', label: 'POS', icon: ShoppingCart },
  { href: '/orders', label: 'Orders', icon: ClipboardList },
  { href: '/utang', label: 'Utang', icon: Wallet },
];

export function BottomTabBar() {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const [moreOpen, setMoreOpen] = useState(false);
  const role = user?.role ?? 'cashier';

  const moreLinks =
    role === 'admin'
      ? [
          { href: '/products', label: 'Products' },
          { href: '/categories', label: 'Categories' },
          { href: '/lowstock', label: 'Low Stock' },
          { href: '/transaction-log', label: 'Transaction Log' },
          { href: '/item-log', label: 'Item Log' },
          { href: '/expenses', label: 'Expenses' },
          { href: '/reports', label: 'Reports' },
          { href: '/users', label: 'Users' },
          { href: '/settings', label: 'Settings' },
        ]
      : [
          { href: '/lowstock', label: 'Low Stock' },
          { href: '/settings', label: 'Settings' },
        ];

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t shadow-lg z-40 flex items-center justify-around py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className="flex flex-col items-center gap-0.5 px-3 cursor-pointer">
              <Icon size={22} className={active ? 'text-green-700' : 'text-gray-400'} />
              <span className={`text-[10px] font-medium ${active ? 'text-green-700' : 'text-gray-400'}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen(!moreOpen)} className="flex flex-col items-center gap-0.5 px-3 cursor-pointer">
          <Menu size={22} className="text-gray-400" />
          <span className="text-[10px] font-medium text-gray-400">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            {moreLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMoreOpen(false)}
                className="block px-4 py-3 text-sm font-medium border-b last:border-0 cursor-pointer"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
