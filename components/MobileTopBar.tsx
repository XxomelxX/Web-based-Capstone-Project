'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Sun, Moon, LogOut } from 'lucide-react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useTheme } from '@/lib/useTheme';
import { OfflineStatusPill } from '@/components/OfflineStatusPill';
import { OfflineSyncModal } from '@/components/OfflineSyncModal';

export function MobileTopBar() {
  const { user } = useCurrentUser();
  const { theme, toggleTheme } = useTheme();
  const [showSyncModal, setShowSyncModal] = useState(false);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('offlineSession');
    }
    signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="md:hidden sticky top-0 z-30 border-b flex items-center justify-between px-4 py-3 bg-green-100">
      <span className="font-bold text-sm text-green-700">J &amp; J Merchandise Store</span>
      <div className="flex items-center gap-2">
        <OfflineStatusPill onClick={() => setShowSyncModal(true)} />
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg border p-2"
          aria-label="Toggle light/dark mode"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-xs text-red-600 font-medium"
          aria-label="Logout"
        >
          <LogOut size={14} />
        </button>
      </div>

      {showSyncModal && <OfflineSyncModal onClose={() => setShowSyncModal(false)} />}
    </div>
  );
}
