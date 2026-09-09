'use client';

import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { getLastSyncTime } from '@/lib/client/timeUtils';

interface CachedDataBannerProps {
  isOffline?: boolean;
  isCached?: boolean;
  onRefresh?: () => void;
  className?: string;
}

export function CachedDataBanner({
  isOffline = false,
  isCached = false,
  onRefresh,
  className = '',
}: CachedDataBannerProps) {
  const [displayTime, setDisplayTime] = useState<string | null>(null);

  useEffect(() => {
    setDisplayTime(getLastSyncTime());
  }, []);

  if (isOffline || isCached) {
    return (
      <div
        className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium backdrop-blur-md mb-4 shadow-sm ${className}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <WifiOff size={16} className="text-amber-400 shrink-0 animate-pulse" />
          <span className="truncate">
            Showing data as of {displayTime ? <strong className="text-amber-200">{displayTime}</strong> : 'last snapshot'} — reconnect to refresh.
          </span>
        </div>
        {onRefresh && !isOffline && (
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition text-[11px] font-semibold shrink-0 cursor-pointer"
          >
            <RefreshCw size={12} />
            <span>Refresh</span>
          </button>
        )}
      </div>
    );
  }

  return null;
}