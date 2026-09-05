'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Sun, Moon, LogOut } from 'lucide-react';
import Image from 'next/image';
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
    <div className="md:hidden sticky top-0 z-30 border-b flex items-center justify-between px-4 py-3 bg-[#15803d]">
      <div className="flex items-center gap-2">
        <Image
          src="/images/81e09f4c-f773-4009-b7d5-6ef3babd8388-removebg-preview.png"
          alt="J & J Merchandise Store logo"
          width={40}
          height={40}
          className="h-10 w-10 object-contain shrink-0"
          style={{ mixBlendMode: 'screen' }}
        />
        <span className="font-bold text-sm text-white">J &amp; J Merchandise Store</span>
      </div>
      <div className="flex items-center gap-2">
        <OfflineStatusPill onClick={() => setShowSyncModal(true)} />
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg border border-slate-700 p-2 text-green-100"
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
