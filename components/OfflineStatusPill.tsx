'use client';

import { useOfflineSync } from '@/lib/useOfflineSync';

export function OfflineStatusPill({ onClick }: { onClick?: () => void }) {
  const { online, queuedCount, failedCount, syncing } = useOfflineSync();

  const show = syncing ? 'syncing' : online && queuedCount === 0 ? 'online' : 'offline';

  const styles: Record<string, string> = {
    syncing: 'bg-sky-500/20 text-sky-300 border border-sky-500/40',
    online: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
    offline: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
  };

  const dot: Record<string, string> = {
    syncing: 'bg-sky-400 animate-pulse',
    online: 'bg-emerald-400',
    offline: 'bg-amber-400',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${styles[show]} ${onClick ? 'hover:opacity-80 transition cursor-pointer text-left' : 'cursor-default'}`}
    >
      <span className={`mr-1.5 h-2 w-2 rounded-full ${dot[show]}`} />
      {syncing
        ? 'Syncing...'
        : online && queuedCount === 0
        ? 'Online'
        : online
        ? `Online (${queuedCount} queued)`
        : `Offline (${queuedCount} queued)`}
      {failedCount > 0 && (
        <span className="ml-1 text-rose-300">⚠ {failedCount}</span>
      )}
    </button>
  );
}
