'use client';

import React from 'react';
import { WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';

interface CachedDataBannerProps {
  cachedAt?: string | null;
  formattedTime?: string | null;
  isOffline?: boolean;
  isCached?: boolean;
  onRefresh?: () => void;
  className?: string;
}

export function CachedDataBanner({
  cachedAt,
  formattedTime,
  isOffline = false,
  isCached = false,
  onRefresh,
  className = '',
}: CachedDataBannerProps) {
  const displayTime = formattedTime || (cachedAt ? new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : null);

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
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition text-[11px] font-semibold shrink-0"
          >
            <RefreshCw size={12} />
            <span>Refresh</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium w-fit mb-4 ${className}`}>
      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
      <span>Updated just now</span>
    </div>
  );
}
